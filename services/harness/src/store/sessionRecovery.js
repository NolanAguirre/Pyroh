const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const runIndexStore = require('./runIndexStore')
const { readJson, writeJson } = require('./jsonFile')
const { loadSession, updateSession } = require('./sessionRecord')
const { usageDir, receiptDir, runRecords, rebuildTotals } = require('./usageStore')

// Only run while holding the session lock: a live daemon must never be repaired
// by another process. Recover persisted completions; leave unfinished work paused.
const recoverSession = (sessionId, writeDir, { excludeRunId } = {}) => {
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const pendingFile = path.join(paths.sessionDir(sessionId, writeDir), 'recovery-pending.json')
  const retryRecovery = fs.existsSync(pendingFile)
  let changed = false
  const beforeChange = () => {
    if (!changed && !retryRecovery) writeJson(pendingFile, { startedAt: Date.now() })
    changed = true
  }
  let sdkRuns = null
  const sdkRecords = () => {
    if (sdkRuns) return sdkRuns
    sdkRuns = new Map()
    const sdkFile = path.join(require('./cursorStore').relocate(sessionId, writeDir), 'runs.ndjson')
    if (fs.existsSync(sdkFile)) {
      for (const line of fs.readFileSync(sdkFile, 'utf8').split('\n')) {
        if (line.trim()) { const record = JSON.parse(line); sdkRuns.set(record.runId, record) }
      }
    }
    return sdkRuns
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
    if (record.endedAt && (record.usage || record.receiptRecovered)) {
      if (retryRecovery) runIndexStore.recordRun(record, session, writeDir, file)
      continue
    }
    let receipt = readJson(path.join(receiptDir(sessionId, writeDir), `${record.id}.json`))
    const sdk = !receipt && !record.endedAt ? sdkRecords().get(record.providerRunId) || [...sdkRecords().values()]
      .filter(item => item.startedAt >= record.startedAt && (!record.providerAgentId || item.agentId === record.providerAgentId))
      .sort((a, b) => a.startedAt - b.startedAt)[0] : null
    if (!receipt && sdk && ['finished', 'error', 'cancelled'].includes(sdk.status)) {
      receipt = { ...sdk, durationMs: (sdk.endedAt || Date.now()) - (sdk.startedAt || record.startedAt),
        transcriptStatus: 'incomplete', transcriptError: 'Daemon stopped before the run finished streaming events' }
    }
    if (receipt && (!record.endedAt || (!record.usage && !record.receiptRecovered))) {
      beforeChange()
      const endedAt = receipt.endedAt || Date.now()
      const durationMs = receipt.durationMs || Math.max(0, endedAt - record.startedAt)
      const failed = receipt.status === 'error' || receipt.transcriptStatus === 'incomplete'
      const status = failed ? 'error' : receipt.status === 'cancelled' ? 'cancelled' : 'completed'
      // Usage first: if interrupted here the unfinished record is recovered again.
      writeJson(path.join(usageDir(sessionId, writeDir), `${record.id}.json`), { runId: record.id, usage: receipt.usage, durationMs })
      const next = { ...record, status, endedAt, durationMs, receiptRecovered: true, usage: receipt.usage ?? record.usage ?? null,
        result: receipt.result, error: receipt.error || receipt.transcriptError || null,
        transcriptStatus: receipt.transcriptStatus, transcriptError: receipt.transcriptError }
      writeJson(file, next)
      runIndexStore.recordRun(next, session, writeDir, file)
      require('../harness/delegation').closeRun(sessionId, record.id)
      if (receipt.providerUsage && (!latestUsage || endedAt > latestUsage.endedAt)) latestUsage = { endedAt, value: receipt.providerUsage }
      if (failed) rememberError(require('./formatError').errorMessage(receipt.error || receipt.transcriptError), record, endedAt)
    } else if (!record.endedAt && record.status === 'running') {
      beforeChange()
      interrupted = true
      const endedAt = Date.now()
      const message = record.pid
        ? 'Daemon stopped before this run completed. Check the daemon log for details.'
        : 'Worker exited before the agent started. Check the daemon log for startup errors.'
      const next = { ...record, status: 'interrupted', endedAt,
        usage: sdk?.usage || record.usage, providerRunId: sdk?.runId || record.providerRunId,
        transcriptStatus: 'incomplete', error: message }
      writeJson(file, next)
      runIndexStore.recordRun(next, session, writeDir, file)
      require('../harness/delegation').closeRun(sessionId, record.id)
      rememberError(message, record, endedAt)
    } else if (retryRecovery) runIndexStore.recordRun(record, session, writeDir, file)
  }
  const patch = {}
  if (latestUsage) patch.providerUsage = latestUsage.value
  if (recoveryError) patch.lastError = recoveryError
  if (['running', 'awaiting_input'].includes(session.status) || interrupted) patch.status = 'paused'
  if (Object.keys(patch).length) updateSession(sessionId, patch, writeDir)
  // A durable marker covers a crash between repairing a run and its totals/index.
  const recovered = changed || retryRecovery ? rebuildTotals(sessionId, writeDir) : loadSession(sessionId, writeDir)
  if (changed || retryRecovery) fs.rmSync(pendingFile, { force: true })
  if (session.parentRunId && (interrupted || recoveryError)) require('../analytics/client').notifySession(sessionId)
  return recovered
}

module.exports = { recoverSession }
