const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const runIndexStore = require('./runIndexStore')
const { readJson, readJsonAsync, writeJson } = require('./jsonFile')
const { genId, loadSession } = require('./sessionRecord')
const { writePromptFile, persistRecordPrompt, readRecordPrompt, readRecordPromptAsync } = require('./recordPrompt')
const { isDelegatedChild, detachDelegation } = require('./delegationBoundary')

const createRun = (sessionId, { mode, prompt, handoff, plugin, delegationDelivery, queuedMessage }, writeDir) => {
  let session = loadSession(sessionId, writeDir)
  if (isDelegatedChild(session)) {
    const runs = listRuns(sessionId, writeDir)
    if (runs.length && !delegationDelivery) {
      session = detachDelegation(session, runs, writeDir)
    } else if (runs.length) {
      const results = runs.flatMap(run => {
        const state = readJson(path.join(paths.sessionDir(sessionId, writeDir), 'delegation', `${run.id}.json`))
        return state && !state.cancelledAt ? Object.values(state.children || {}) : []
      })
      const automaticContinuation = !session.stopRequestedAt && session.status !== 'stopped' &&
        typeof delegationDelivery?.batchId === 'string' && delegationDelivery.batchId &&
        Array.isArray(delegationDelivery.resultIds) && delegationDelivery.resultIds.length > 0 &&
        delegationDelivery.resultIds.every(id => typeof id === 'string' && id &&
          results.some(child => child.dontReturn !== true && child.resultId === id && child.result?.done && child.delivery?.status === 'pending') &&
          !runs.some(run => run.delegationDelivery?.resultIds?.includes(id)))
      if (!automaticContinuation) throw new Error('Invalid automatic child result delivery')
    }
  }
  const ancestry = session ? {
    parentSessionId: session.parentSessionId,
    ...(session.parentRunId ? { parentRunId: session.parentRunId } : {}),
    rootSessionId: session.rootSessionId,
    lineage: session.lineage,
    depth: session.depth,
  } : {}
  const id = genId('r')
  const file = paths.runFile(sessionId, id, writeDir)
  const run = persistRecordPrompt(file, {
    id,
    sessionId,
    ...ancestry,
    mode,
    prompt,
    ...(handoff ? { handoff } : {}),
    ...(plugin ? { plugin } : {}),
    ...(delegationDelivery ? { delegationDelivery } : {}),
    ...(queuedMessage ? { queuedMessage } : {}),
    status: 'running',
    pid: null,
    startedAt: Date.now(),
    endedAt: null,
    durationMs: 0,
    usage: null,
    result: null,
    error: null,
  })
  writeJson(file, run)
  runIndexStore.recordRun(run, loadSession(sessionId, writeDir), writeDir, file)
  return run
}

const loadRun = (sessionId, runId, writeDir) =>
  readJson(paths.runFile(sessionId, runId, writeDir), null)

const listRuns = (sessionId, writeDir) => {
  const dir = paths.runsDir(sessionId, writeDir)
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const runs = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    const run = readJson(file, null)
    if (!run) continue
    let prompt = null
    try {
      prompt = readRecordPrompt(run, file)
    } catch {
      prompt = null
    }
    runs.push(prompt == null ? run : { ...run, prompt })
  }
  runs.sort((a, b) => a.startedAt - b.startedAt)
  return runs
}

const listRunsAsync = async (sessionId, writeDir) => {
  const dir = paths.runsDir(sessionId, writeDir)
  let names
  try {
    names = await fs.promises.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const runs = (await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
    const file = path.join(dir, name)
    const run = await readJsonAsync(file, null)
    if (!run) return null
    const prompt = await readRecordPromptAsync(run, file).catch(() => null)
    return prompt == null ? run : { ...run, prompt }
  }))).filter(Boolean)
  runs.sort((a, b) => a.startedAt - b.startedAt)
  return runs
}

const updateRun = (sessionId, runId, patch, writeDir) => {
  const run = loadRun(sessionId, runId, writeDir)
  if (!run) throw new Error(`run not found: ${runId}`)
  const file = paths.runFile(sessionId, runId, writeDir)
  const next = persistRecordPrompt(file, { ...run, ...patch })
  writeJson(file, next)
  runIndexStore.recordRun(next, loadSession(sessionId, writeDir), writeDir, file)
  return next
}

const readRunPrompt = (sessionId, runId, writeDir) => {
  const file = paths.runFile(sessionId, runId, writeDir)
  return readRecordPrompt(loadRun(sessionId, runId, writeDir), file)
}

const writeRunPrompt = (sessionId, runId, text, writeDir) => {
  const run = loadRun(sessionId, runId, writeDir)
  if (!run) throw new Error(`run not found: ${runId}`)
  const file = paths.runFile(sessionId, runId, writeDir)
  if (!run.promptFile) return updateRun(sessionId, runId, { prompt: text }, writeDir)
  const promptPath = path.isAbsolute(run.promptFile) ? run.promptFile : path.join(path.dirname(file), run.promptFile)
  writePromptFile(promptPath, text)
  return run
}

module.exports = {
  createRun,
  loadRun,
  listRuns,
  listRunsAsync,
  updateRun,
  readRunPrompt,
  writeRunPrompt,
}
