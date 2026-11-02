const fs = require('fs')
const path = require('path')
const config = require('../config')
const paths = require('./paths')
const store = require('./sessionStore')
const locks = require('./sessionLock')
const { runRecords, receiptDir } = require('./usageStore')
const { readJson, writeJson } = require('./jsonFile')
const runIndex = require('./runIndexStore')

const pending = new Map()
const hasTokens = (usage) => usage && usage.inputTokens + usage.outputTokens > 0
const fetchUsage = async (agentId) => {
  let timer
  try {
    const { Agent } = require('@cursor/sdk')
    return await Promise.race([
      Agent.getUsage(agentId, config.cursorApiKey ? { apiKey: config.cursorApiKey } : {}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cursor usage request timed out')), 15000) }),
    ])
  } finally { clearTimeout(timer) }
}
const sdkRecords = (sessionId, writeDir) => {
  const file = path.join(paths.sessionSdkStoreDir(sessionId, writeDir), 'runs.ndjson')
  try {
    return [...new Map(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map(line => { const record = JSON.parse(line); return [record.runId, record] })).values()]
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const recover = async (sessionId, writeDir) => {
  const session = store.loadSession(sessionId, writeDir)
  if (!session || session.provider !== 'cursor') return { recovered: [] }
  if (locks.holds(sessionId, writeDir) || ['running', 'awaiting_input', 'queued'].includes(session.status)) {
    return { recovered: [], pending: true }
  }
  const records = runRecords(sessionId, writeDir)
  const missing = records.filter(({ record }) => record.endedAt && !record.usage && record.providerAgentId)
  if (!missing.length) return { recovered: [] }
  const sdkRuns = sdkRecords(sessionId, writeDir)
  const patches = []
  const billing = new Map()
  for (const { file, record } of missing) {
    const agentRuns = records.filter(item => item.record.providerAgentId === record.providerAgentId)
    const saved = sdkRuns.filter(item => item.agentId === record.providerAgentId)
    // Local billing IDs are usage UUIDs, not the client-side run IDs. Agent
    // totals are safe only when this entire agent belongs to one harness run.
    // This includes steered segments, which share that harness run.
    const singleRun = agentRuns.length === 1 && records.every(item => item.record.providerAgentId) &&
      saved.length > 0 && saved.every(item => ['finished', 'cancelled', 'error', 'expired'].includes(item.status))
    const segments = saved.filter(item => item.startedAt >= record.startedAt && item.startedAt <= record.endedAt)
    let usage = null
    let source = 'cursor-billing'
    if (segments.length && segments.every(item => item.usage && ['finished', 'cancelled', 'error', 'expired'].includes(item.status))) {
      usage = segments.reduce((sum, item) => {
        for (const [key, value] of Object.entries(item.usage)) {
          if (typeof value === 'number') sum[key] = (sum[key] || 0) + value
        }
        return sum
      }, {})
      source = 'cursor-store'
    }
    if (!hasTokens(usage)) {
      if (!singleRun) continue
      if (!billing.has(record.providerAgentId)) {
        billing.set(record.providerAgentId, await fetchUsage(record.providerAgentId))
      }
      usage = billing.get(record.providerAgentId)?.usage
      source = 'cursor-billing'
    }
    // Billing can lag after cancellation. Leave absent usage unknown and retry
    // later, rather than permanently saving an empty response as zero spend.
    if (!hasTokens(usage)) continue
    patches.push({ file, record, usage: { ...usage, totalTokens: usage.inputTokens + usage.outputTokens }, source })
  }
  if (!patches.length) return { recovered: [], pending: true }
  // Do not hold a reentrant process lock across network awaits. Recheck under
  // the lock so a new run cannot race attribution of an agent-wide total.
  if (locks.holds(sessionId, writeDir)) return { recovered: [], pending: true }
  let lock
  const recovered = []
  try {
    lock = locks.acquire(sessionId, writeDir)
    const current = runRecords(sessionId, writeDir)
    if (current.length !== records.length || current.some(({ record }) => !record.endedAt)) {
      return { recovered: [], pending: true }
    }
    for (const patch of patches) {
      const record = readJson(patch.file)
      if (!record || record.usage || record.providerAgentId !== patch.record.providerAgentId) continue
      const next = { ...record, usage: patch.usage, usageSource: patch.source, usageRecoveredAt: Date.now() }
      const receiptFile = path.join(receiptDir(sessionId, writeDir), `${record.id}.json`)
      const receipt = readJson(receiptFile, null)
      // Keep the receipt authoritative if recovery is interrupted midway.
      writeJson(receiptFile, { ...(receipt || record), runId: record.id, usage: patch.usage })
      store.addToTotals(sessionId, { runId: record.id, usage: patch.usage, durationMs: record.durationMs }, writeDir)
      writeJson(patch.file, next)
      runIndex.recordRun(next, store.loadSession(sessionId, writeDir), writeDir, patch.file)
      recovered.push(record.id)
    }
  } catch (err) {
    if (err.status !== 409) throw err
  } finally { lock?.release() }
  if (recovered.length) await require('../analytics/client').notifySession(sessionId)
  return { recovered, pending: recovered.length < missing.length }
}

const recoverMissingUsage = (sessionId, writeDir = config.writeDir) => {
  const key = `${writeDir}\0${sessionId}`
  if (!pending.has(key)) pending.set(key, recover(sessionId, writeDir).finally(() => pending.delete(key)))
  return pending.get(key)
}

const recoverAll = async () => {
  for (const session of await store.listSessionsAsync(config.writeDir)) {
    if (session.provider !== 'cursor') continue
    try { await recoverMissingUsage(session.id) }
    catch (err) { process.stderr.write(`Cursor usage recovery for ${session.id}: ${err.message}\n`) }
  }
}

module.exports = { recoverMissingUsage, recoverAll }
