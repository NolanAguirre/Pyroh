const fs = require('fs')
const path = require('path')
const readline = require('readline')
const paths = require('./paths')

// Called while holding the session lock. Migrate only this agent's records;
// never open the old shared store for writing or fall back to it on errors.
// A fresh run starts a new agent in the session store, so several saved
// agents are expected and none is adopted.
const prepare = async (session, writeDir, { fresh } = {}) => {
  const target = paths.sessionSdkStoreDir(session.id, writeDir)
  if (fresh) {
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true, mode: 0o700 })
    return target
  }
  if (fs.existsSync(target)) {
    // A crash can occur after SDK creation but before the harness records its ID.
    const agentsFile = path.join(target, 'agents.ndjson')
    if (!session.providerAgentId && fs.existsSync(agentsFile)) {
      const agents = fs.readFileSync(agentsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      if (agents.length > 1) throw new Error('Multiple saved agents in one session; refusing to choose a conversation')
      if (agents.length === 1) {
        session.providerAgentId = agents[0].agentId
        require('./sessionStore').updateSession(session.id, { providerAgentId: session.providerAgentId }, writeDir)
      }
    }
    return target
  }
  if (!session.providerAgentId) {
    fs.mkdirSync(target, { recursive: true, mode: 0o700 })
    return target
  }
  const temporary = `${target}.import-${process.pid}`
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 })
  const runIds = new Set()
  let found = false
  try {
    for (const name of ['agents.ndjson', 'runs.ndjson', 'checkpoints.ndjson', 'run_events.ndjson']) {
      const source = path.join(paths.sdkStoreDir(writeDir), name)
      const fd = fs.openSync(path.join(temporary, name), 'w', 0o600)
      try {
        const lines = readline.createInterface({ input: fs.createReadStream(source), crlfDelay: Infinity })
        for await (const line of lines) {
          if (!line.trim()) continue
          const item = JSON.parse(line)
          const matches = name === 'run_events.ndjson' ? runIds.has(item.runId) : item.agentId === session.providerAgentId
          if (!matches) continue
          if (name === 'agents.ndjson') found = true
          if (name === 'runs.ndjson') runIds.add(item.runId)
          fs.writeSync(fd, `${line}\n`)
        }
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
    }
    if (!found) throw new Error(`Saved Cursor agent ${session.providerAgentId} is missing; refusing to replace this session with a new agent`)
    fs.renameSync(temporary, target)
    return target
  } catch (err) {
    fs.rmSync(temporary, { recursive: true, force: true })
    throw err
  }
}

module.exports = { prepare }
