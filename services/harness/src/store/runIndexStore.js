const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { readJson, writeJson } = require('./jsonFile')

// One atomic file per run avoids lost entries when sessions run concurrently.
const recordRun = (run, session, writeDir, runFile) => {
  const sourceSessionId = session?.sourceSessionId || null
  const entry = {
    runId: run.id,
    sessionId: run.sessionId,
    sourceSessionId,
    workspaceId: session?.workspaceId || null,
    mode: run.step ? 'decompose' : run.mode,
    agentMode: run.mode,
    step: run.step || null,
    phase: run.phase ?? null,
    provider: session?.provider || null,
    model: session?.model || null,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
    status: run.status,
    durationMs: run.durationMs ?? 0,
    usage: run.usage ?? null,
    sessionPath: path.resolve(paths.sessionFile(run.sessionId, writeDir)),
    runPath: path.resolve(runFile || paths.runFile(run.sessionId, run.id, writeDir)),
    // Normalized events work across providers; select the section by runId.
    transcriptPath: path.resolve(paths.eventsFile(run.sessionId, writeDir)),
    sourceSessionPath: sourceSessionId
      ? path.resolve(paths.sessionFile(sourceSessionId, writeDir)) : null,
    sourceTranscriptPath: sourceSessionId
      ? path.resolve(paths.eventsFile(sourceSessionId, writeDir)) : null,
  }
  return writeJson(path.join(paths.runIndexDir(writeDir), `${run.id}.json`), entry)
}

const readEntries = (dir) => {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return names.filter(name => name.endsWith('.json'))
    .map(name => readJson(path.join(dir, name)))
    .filter(Boolean)
}

const listRuns = (writeDir, { mode } = {}) => {
  // Keep entries written before the index covered every mode discoverable.
  const entries = new Map(readEntries(paths.tokenWasteIndexDir(writeDir))
    .map(entry => [entry.runId, { ...entry, mode: 'token-waste' }]))
  for (const entry of readEntries(paths.runIndexDir(writeDir))) entries.set(entry.runId, entry)
  return [...entries.values()]
    .filter(entry => !mode || entry.mode === mode)
    .sort((a, b) => b.startedAt - a.startedAt || a.runId.localeCompare(b.runId))
}

module.exports = { recordRun, listRuns }
