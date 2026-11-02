const fs = require('fs')
const path = require('path')
const runIndexStore = require('./runIndexStore')
const { readJson, writeJson } = require('./jsonFile')
const { loadSession, updateSession } = require('./sessionRecord')
const { usageDir, receiptDir, jsonRecords, runRecords, rebuildTotals } = require('./usageStore')

// Only run while holding the session lock: a live daemon must never be repaired
// by another process. Recover persisted completions; leave unfinished work paused.
const recoverSession = (sessionId, writeDir, { excludeRunId } = {}) => {
  const session = loadSession(sessionId, writeDir)
  if (!session) throw new Error(`session not found: ${sessionId}`)
  const receipts = new Map(jsonRecords(receiptDir(sessionId, writeDir)).map(({ record }) => [record.runId, record]))
  const sdkRuns = new Map()
  const sdkFile = path.join(require('./cursorStore').relocate(sessionId, writeDir), 'runs.ndjson')
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
        transcriptStatus: 'incomplete', transcriptError: 'Daemon stopped before the run finished streaming events' }
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
    if (readJson(file)?.endedAt) require('../harness/delegation').closeRun(sessionId, record.id)
    runIndexStore.recordRun(readJson(file), session, writeDir, file)
  }
  const patch = {}
  if (latestUsage) patch.providerUsage = latestUsage.value
  if (recoveryError) patch.lastError = recoveryError
  if (['running', 'awaiting_input'].includes(session.status) || interrupted) patch.status = 'paused'
  if (Object.keys(patch).length) updateSession(sessionId, patch, writeDir)
  const recovered = rebuildTotals(sessionId, writeDir)
  if (session.parentRunId && (interrupted || recoveryError)) require('../analytics/client').notifySession(sessionId)
  return recovered
}

module.exports = { recoverSession }
