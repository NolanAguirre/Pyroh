const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const paths = require('./paths')
const workspaceStore = require('./workspaceStore')
const runIndexStore = require('./runIndexStore')
const sessionIndex = require('./sessionIndex')
const { readJson, readJsonAsync, writeJson, ensureDir } = require('./jsonFile')
const { listProviders } = require('../agents/driver')
const { normalizeCodexOptions } = require('../agents/providers/codexOptions')
const { normalizeGrokOptions } = require('../agents/providers/grokOptions')
const { normalizeClaudeOptions } = require('../agents/providers/claudeOptions')

const genId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

const emptyTotals = () => ({
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
  durationMs: 0,
})

const persistableSession = (session) => {
  const { logPath, eventsPath, ...stored } = session
  return stored
}

const withCwd = (session, cwd, writeDir) => ({
  ...persistableSession(session),
  cwd,
  logPath: paths.daemonLog(session.id, writeDir),
  eventsPath: paths.eventsFile(session.id, writeDir),
})

const withResolvedCwd = (session, writeDir) => {
  if (!session) return session
  return withCwd(session, workspaceStore.resolveSessionCwd(session, writeDir), writeDir)
}

const withResolvedCwdAsync = async (session, writeDir, workspaces) => {
  if (!session) return session
  return withCwd(session, await workspaceStore.resolveSessionCwdAsync(session, writeDir, workspaces), writeDir)
}

const writeSession = (next, writeDir) => {
  const file = paths.sessionFile(next.id, writeDir)
  writeJson(file, next)
  sessionIndex.upsert(next, fs.statSync(file).mtimeMs, writeDir)
  return next
}

const createSession = ({ workspaceId, provider, model, codex, grok, claude }, writeDir) => {
  if (!listProviders().includes(provider)) throw new Error(`unknown provider: ${provider}`)
  const providerOptions = provider === 'codex' ? { codex: normalizeCodexOptions(codex) }
    : provider === 'grok' ? { grok: normalizeGrokOptions(grok) }
      : provider === 'claude' ? { claude: normalizeClaudeOptions(claude) }
        : {}
  if (!workspaceId) throw new Error('workspaceId is required')
  const workspace = workspaceStore.loadWorkspace(workspaceId, writeDir)
  if (!workspace) throw new Error(`workspace not found: ${workspaceId}`)
  const id = genId('s')
  const now = Date.now()
  paths.rememberSession(id, workspaceId, writeDir)
  const session = {
    id,
    workspaceId,
    provider,
    model: model || null,
    ...providerOptions,
    cwd: workspace.cwd,
    providerAgentId: null,
    name: null,
    status: 'idle',
    archived: false,
    pinned: false,
    totals: emptyTotals(),
    createdAt: now,
    updatedAt: now,
  }
  writeSession(session, writeDir)
  ensureDir(paths.runsDir(id, writeDir))
  ensureDir(paths.questionsDir(id, writeDir))
  return withResolvedCwd(session, writeDir)
}

const loadSession = (sessionId, writeDir) =>
  withResolvedCwd(readJson(paths.sessionFile(sessionId, writeDir), null), writeDir)

const listSessionNames = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readSessionsFromDir = (dir, writeDir, remember) => {
  const sessions = []
  for (const name of listSessionNames(dir)) {
    if (remember) remember(name)
    const session = loadSession(name, writeDir)
    if (session) sessions.push(session)
  }
  return sessions
}

const listSessionsInWorkspace = (workspaceId, writeDir) => {
  const workspace = workspaceStore.loadWorkspace(workspaceId, writeDir)
  const sessions = readSessionsFromDir(
    paths.sessionsDir(workspaceId, writeDir),
    writeDir,
    (name) => paths.rememberSession(name, workspaceId, writeDir),
  )
  const legacy = readSessionsFromDir(
    paths.legacySessionsDir(writeDir),
    writeDir,
    (name) => paths.rememberLegacySession(name, writeDir),
  ).filter((session) => {
    if (session.workspaceId === workspaceId) return true
    if (session.workspaceId || !workspace) return false
    if (session.cwd !== workspace.cwd) return false
    const owner = workspaceStore.findWorkspaceByCwd(session.cwd, writeDir)
    return owner && owner.id === workspaceId
  })
  const byId = new Map()
  for (const session of [...sessions, ...legacy]) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const listSessions = (writeDir, workspaceId) => {
  if (workspaceId) return listSessionsInWorkspace(workspaceId, writeDir)
  const byId = new Map()
  for (const workspace of workspaceStore.listWorkspaces(writeDir)) {
    for (const session of listSessionsInWorkspace(workspace.id, writeDir)) {
      byId.set(session.id, session)
    }
  }
  for (const session of readSessionsFromDir(
    paths.legacySessionsDir(writeDir),
    writeDir,
    (name) => paths.rememberLegacySession(name, writeDir),
  )) {
    if (!byId.has(session.id)) byId.set(session.id, session)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const loadSessionAsync = async (sessionId, writeDir, workspaces) =>
  withResolvedCwdAsync(await readJsonAsync(paths.sessionFile(sessionId, writeDir), null), writeDir, workspaces)

const listSessionNamesAsync = async (dir) => {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readSessionsFromDirAsync = async (dir, writeDir, remember, workspaces) => {
  const names = await listSessionNamesAsync(dir)
  for (const name of names) remember(name)
  return (await Promise.all(names.map((name) => loadSessionAsync(name, writeDir, workspaces)))).filter(Boolean)
}

const readLegacySessionsAsync = (writeDir, workspaces) => readSessionsFromDirAsync(
  paths.legacySessionsDir(writeDir),
  writeDir,
  (name) => paths.rememberLegacySession(name, writeDir),
  workspaces,
)

const listSessionsInWorkspaceAsync = async (workspaceId, writeDir, { workspaces = new Map(), legacy } = {}) => {
  const [workspace, sessions, legacySessions] = await Promise.all([
    workspaceStore.loadWorkspaceAsync(workspaceId, writeDir),
    readSessionsFromDirAsync(
      paths.sessionsDir(workspaceId, writeDir),
      writeDir,
      (name) => paths.rememberSession(name, workspaceId, writeDir),
      workspaces,
    ),
    legacy || readLegacySessionsAsync(writeDir, workspaces),
  ])
  let allWorkspaces = null
  const owned = []
  for (const session of legacySessions) {
    if (session.workspaceId === workspaceId) owned.push(session)
    if (session.workspaceId || !workspace || session.cwd !== workspace.cwd) continue
    allWorkspaces ??= await workspaceStore.listWorkspacesAsync(writeDir)
    const owner = allWorkspaces.find((item) => item.cwd === session.cwd)
    if (owner && owner.id === workspaceId) owned.push(session)
  }
  const byId = new Map()
  for (const session of [...sessions, ...owned]) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const listSessionsAsync = async (writeDir, workspaceId) => {
  const workspaces = new Map()
  const legacy = readLegacySessionsAsync(writeDir, workspaces)
  if (workspaceId) return listSessionsInWorkspaceAsync(workspaceId, writeDir, { workspaces, legacy })
  const byId = new Map()
  const lists = await Promise.all((await workspaceStore.listWorkspacesAsync(writeDir))
    .map((workspace) => listSessionsInWorkspaceAsync(workspace.id, writeDir, { workspaces, legacy })))
  for (const session of lists.flat()) byId.set(session.id, session)
  for (const session of await legacy) {
    if (!byId.has(session.id)) byId.set(session.id, session)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

const updateSession = (sessionId, patch, writeDir) => {
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const next = persistableSession({ ...session, ...patch, updatedAt: Date.now() })
  writeSession(next, writeDir)
  return withResolvedCwd(next, writeDir)
}

const promptFileName = (jsonFile) => `${path.basename(jsonFile, '.json')}.prompt.txt`

const writePromptFile = (file, text) => {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text == null ? '' : String(text))
  return file
}

// Move an inline prompt onto a sibling .prompt.txt and point at it from JSON.
// If promptFile is already set, keep that file (do not overwrite on status patches).
const persistRecordPrompt = (jsonFile, record) => {
  if (!record) return record
  if (record.prompt == null) {
    const next = { ...record }
    delete next.prompt
    return next
  }
  if (record.promptFile) {
    const next = { ...record }
    delete next.prompt
    return next
  }
  const name = promptFileName(jsonFile)
  writePromptFile(path.join(path.dirname(jsonFile), name), record.prompt)
  const next = {}
  Object.keys(record).forEach((key) => {
    if (key === 'prompt') next.promptFile = name
    else next[key] = record[key]
  })
  return next
}

const readRecordPrompt = (record, jsonFile) => {
  if (!record) return null
  if (record.promptFile) {
    const file = path.isAbsolute(record.promptFile)
      ? record.promptFile
      : path.join(path.dirname(jsonFile), record.promptFile)
    return fs.readFileSync(file, 'utf8')
  }
  if (record.prompt != null) return record.prompt
  return null
}

const readRecordPromptAsync = async (record, jsonFile) => {
  if (!record) return null
  if (record.promptFile) {
    const file = path.isAbsolute(record.promptFile)
      ? record.promptFile
      : path.join(path.dirname(jsonFile), record.promptFile)
    return fs.promises.readFile(file, 'utf8')
  }
  if (record.prompt != null) return record.prompt
  return null
}

const createRun = (sessionId, { mode, prompt, handoff, plugin }, writeDir) => {
  const id = genId('r')
  const file = paths.runFile(sessionId, id, writeDir)
  const run = persistRecordPrompt(file, {
    id,
    sessionId,
    mode,
    prompt,
    ...(handoff ? { handoff } : {}),
    ...(plugin ? { plugin } : {}),
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

const writePlan = (sessionId, runId, text, writeDir) => {
  const file = paths.planFile(sessionId, runId, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const writeSourcePlan = (sessionId, text, writeDir) => {
  const file = paths.sourcePlanFile(sessionId, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const readSourcePlan = (sessionId, writeDir) => {
  try {
    return fs.readFileSync(paths.sourcePlanFile(sessionId, writeDir), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const writePhases = (sessionId, data, writeDir) => writeJson(paths.phasesFile(sessionId, writeDir), data)

const readPhases = (sessionId, writeDir) => readJson(paths.phasesFile(sessionId, writeDir), null)

const writePhasePlan = (sessionId, phase, text, writeDir) => {
  const file = paths.phasePlanFile(sessionId, phase, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

const readPhasePlan = (sessionId, phase, writeDir) => {
  try {
    return fs.readFileSync(paths.phasePlanFile(sessionId, phase, writeDir), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

const writeStepRun = (sessionId, { phase, stepId }, record, writeDir) => {
  const file = paths.stepRunFile(sessionId, phase, stepId, writeDir)
  const stored = persistRecordPrompt(file, record)
  writeJson(file, stored)
  runIndexStore.recordRun(stored, loadSession(sessionId, writeDir), writeDir, file)
  return stored
}

const loadStepRun = (sessionId, { phase, stepId }, writeDir) =>
  readJson(paths.stepRunFile(sessionId, phase, stepId, writeDir), null)

const readStepRunPrompt = (sessionId, { phase, stepId }, writeDir) => {
  const file = paths.stepRunFile(sessionId, phase, stepId, writeDir)
  return readRecordPrompt(loadStepRun(sessionId, { phase, stepId }, writeDir), file)
}

const writeStepArtifact = (sessionId, { phase, filename }, text, writeDir) => {
  const file = paths.stepWriteFile(sessionId, phase, filename, writeDir)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, text || '')
  return file
}

// Cursor SDK inputTokens already include cache reads/writes, but its totalTokens
// adds them again, so the Cursor total is recomputed from input + output.
const normalizeUsage = (usage, provider) => {
  if (!usage) return null
  const input = usage.inputTokens ?? usage.input_tokens ?? usage.input ?? 0
  const output = usage.outputTokens ?? usage.output_tokens ?? usage.output ?? 0
  const cacheRead =
    usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cacheRead ?? 0
  const cacheWrite =
    usage.cacheWriteTokens ?? usage.cache_write_tokens ?? usage.cacheWrite ?? 0
  const reasoning = usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoning ?? 0
  const total = provider === 'cursor' ? input + output
    : usage.totalTokens ?? usage.total_tokens ?? usage.total ?? input + output + reasoning
  return { input, output, cacheRead, cacheWrite, reasoning, total }
}

// Completion receipts and usage entries are keyed by run ID. Rebuilding totals
// is idempotent even if a process dies between saving usage and finalizing a run.
const usageDir = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'usage')
const receiptDir = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'receipts')

const jsonRecords = (dir) => {
  let names
  try { names = fs.readdirSync(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  return names.filter(name => name.endsWith('.json')).map(name => {
    const file = path.join(dir, name)
    return { file, record: readJson(file, null) }
  })
}

const runRecords = (sessionId, writeDir) => {
  const dir = paths.sessionDir(sessionId, writeDir)
  const directories = [paths.runsDir(sessionId, writeDir), dir]
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(dir, name.name))
  }
  return directories.flatMap(jsonRecords).filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

const jsonRecordsAsync = async (dir) => {
  let names
  try { names = await fs.promises.readdir(dir) } catch (err) { if (err.code === 'ENOENT') return []; throw err }
  return Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
    const file = path.join(dir, name)
    return { file, record: await readJsonAsync(file, null) }
  }))
}

const runRecordsAsync = async (sessionId, writeDir) => {
  const dir = paths.sessionDir(sessionId, writeDir)
  const directories = [paths.runsDir(sessionId, writeDir), dir]
  for (const name of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (name.isDirectory() && /^phase-/.test(name.name)) directories.push(path.join(dir, name.name))
  }
  return (await Promise.all(directories.map(jsonRecordsAsync))).flat()
    .filter(({ record }) => record?.sessionId === sessionId && record.id && 'usage' in record)
}

const totalsMatch = (left, right) => {
  if (!left || !right || left.durationMs !== right.durationMs) return false
  const a = left.tokens || {}
  const b = right.tokens || {}
  return Object.keys({ ...a, ...b }).every((key) => (a[key] || 0) === (b[key] || 0))
}

// One entry per run: usage records win over the usage copied onto run records.
// Usage records whose run record was replaced fall back to the file's mtime.
const listRunUsage = (sessionId, writeDir) => {
  const entries = new Map(runRecords(sessionId, writeDir).map(({ record }) => [record.id, {
    runId: record.id, startedAt: record.startedAt, step: record.step ?? null, usage: record.usage, durationMs: record.durationMs,
  }]))
  for (const { file, record } of jsonRecords(usageDir(sessionId, writeDir))) {
    if (!record?.runId) continue
    const run = entries.get(record.runId)
    entries.set(record.runId, {
      runId: record.runId,
      startedAt: run?.startedAt ?? fs.statSync(file).mtimeMs,
      step: run?.step ?? null,
      usage: record.usage,
      durationMs: record.durationMs,
    })
  }
  return [...entries.values()]
}

const listRunUsageAsync = async (sessionId, writeDir) => {
  const [runs, usage] = await Promise.all([runRecordsAsync(sessionId, writeDir), jsonRecordsAsync(usageDir(sessionId, writeDir))])
  const entries = new Map(runs.map(({ record }) => [record.id, {
    runId: record.id, startedAt: record.startedAt, step: record.step ?? null, usage: record.usage, durationMs: record.durationMs,
  }]))
  for (const { file, record } of usage) {
    if (!record?.runId) continue
    const run = entries.get(record.runId)
    entries.set(record.runId, {
      runId: record.runId,
      startedAt: run?.startedAt ?? (await fs.promises.stat(file)).mtimeMs,
      step: run?.step ?? null,
      usage: record.usage,
      durationMs: record.durationMs,
    })
  }
  return [...entries.values()]
}

const rebuildTotals = (sessionId, writeDir) => {
  const entries = listRunUsage(sessionId, writeDir)
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const totals = emptyTotals()
  for (const record of entries) {
    const usage = normalizeUsage(record.usage, session.provider)
    if (usage) for (const key of Object.keys(totals.tokens)) totals.tokens[key] += usage[key]
    totals.durationMs += record.durationMs || 0
  }
  if (totalsMatch(session.totals, totals)) return session
  const next = persistableSession({ ...session, totals })
  writeSession(next, writeDir)
  return withResolvedCwd(next, writeDir)
}

const addToTotals = (sessionId, { runId, usage, durationMs }, writeDir) => {
  if (!runId) throw new Error('Usage accounting requires a run ID')
  writeJson(path.join(usageDir(sessionId, writeDir), `${runId}.json`), { runId, usage, durationMs })
  return rebuildTotals(sessionId, writeDir)
}

// Only run while holding the session lock: a live daemon must never be repaired
// by another process. Recover persisted completions; leave unfinished work paused.
const recoverSession = (sessionId, writeDir, { excludeRunId } = {}) => {
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const receipts = new Map(jsonRecords(receiptDir(sessionId, writeDir)).map(({ record }) => [record.runId, record]))
  const sdkRuns = new Map()
  const sdkFile = path.join(paths.sessionSdkStoreDir(sessionId, writeDir), 'runs.ndjson')
  if (fs.existsSync(sdkFile)) {
    for (const line of fs.readFileSync(sdkFile, 'utf8').split('\n')) {
      if (line.trim()) { const record = JSON.parse(line); sdkRuns.set(record.runId, record) }
    }
  }
  let interrupted = false
  let latestUsage = null
  let recoveryError = null
  const rememberError = (message, record, at) => {
    if (!recoveryError || at >= recoveryError.at) recoveryError = { message, runId: record.id, at }
    require('./eventLog').append(sessionId, { type: 'error', message, runId: record.id }, writeDir)
  }
  for (const { file, record } of runRecords(sessionId, writeDir)) {
    if (record.id === excludeRunId) continue
    let receipt = receipts.get(record.id)
    const sdk = sdkRuns.get(record.providerRunId) || (!record.endedAt && [...sdkRuns.values()]
      .filter(item => item.startedAt >= record.startedAt && (!record.providerAgentId || item.agentId === record.providerAgentId))
      .sort((a, b) => a.startedAt - b.startedAt)[0])
    if (!receipt && sdk && ['finished', 'error', 'cancelled'].includes(sdk.status)) {
      receipt = { ...sdk, durationMs: (sdk.endedAt || Date.now()) - (sdk.startedAt || record.startedAt),
        transcriptStatus: 'incomplete', transcriptError: 'Daemon stopped before the audit transcript was finalized' }
    }
    if (receipt && (!record.endedAt || (!record.usage && !record.receiptRecovered))) {
      const endedAt = receipt.endedAt || Date.now()
      const durationMs = receipt.durationMs || Math.max(0, endedAt - record.startedAt)
      const failed = receipt.status === 'error' || receipt.transcriptStatus === 'incomplete'
      const status = failed ? 'error' : receipt.status === 'cancelled' ? 'cancelled' : 'completed'
      writeJson(file, { ...record, status, endedAt, durationMs, receiptRecovered: true, usage: receipt.usage ?? record.usage ?? null,
        result: receipt.result, error: receipt.error || receipt.transcriptError || null,
        transcriptStatus: receipt.transcriptStatus, transcriptError: receipt.transcriptError })
      writeJson(path.join(usageDir(sessionId, writeDir), `${record.id}.json`), { runId: record.id, usage: receipt.usage, durationMs })
      if (receipt.providerUsage && (!latestUsage || endedAt > latestUsage.endedAt)) latestUsage = { endedAt, value: receipt.providerUsage }
      if (failed) rememberError(require('./formatError').errorMessage(receipt.error || receipt.transcriptError), record, endedAt)
    } else if (!record.endedAt && record.status === 'running') {
      interrupted = true
      const endedAt = Date.now()
      const message = record.pid
        ? 'Daemon stopped before this run completed. Check the daemon log for details.'
        : 'Worker exited before the agent started. Check the daemon log for startup errors.'
      writeJson(file, { ...record, status: 'interrupted', endedAt,
        usage: sdk?.usage || record.usage, providerRunId: sdk?.runId || record.providerRunId,
        transcriptStatus: 'incomplete', error: message })
      rememberError(message, record, endedAt)
    }
    runIndexStore.recordRun(readJson(file), session, writeDir, file)
  }
  const patch = {}
  if (latestUsage) patch.providerUsage = latestUsage.value
  if (recoveryError) patch.lastError = recoveryError
  if (['running', 'awaiting_input'].includes(session.status) || interrupted) patch.status = 'paused'
  if (Object.keys(patch).length) updateSession(sessionId, patch, writeDir)
  return rebuildTotals(sessionId, writeDir)
}

module.exports = {
  genId,
  emptyTotals,
  normalizeUsage,
  withCwd,
  writeSession,
  createSession,
  loadSession,
  loadSessionAsync,
  listSessions,
  listSessionsAsync,
  updateSession,
  createRun,
  loadRun,
  listRuns,
  listRunsAsync,
  updateRun,
  readRunPrompt,
  writeRunPrompt,
  readRecordPrompt,
  writePlan,
  writeSourcePlan,
  readSourcePlan,
  writePhases,
  readPhases,
  writePhasePlan,
  readPhasePlan,
  writeStepRun,
  loadStepRun,
  readStepRunPrompt,
  writeStepArtifact,
  addToTotals,
  recoverSession,
  rebuildTotals,
  listRunUsage,
  listRunUsageAsync,
}
