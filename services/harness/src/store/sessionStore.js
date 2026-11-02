const sessionRecord = require('./sessionRecord')
const { listSessions, listSessionsAsync } = require('./sessionList')
const { readRecordPrompt } = require('./recordPrompt')
const runStore = require('./runStore')
const planStore = require('./planStore')
const usageStore = require('./usageStore')
const { recoverSession } = require('./sessionRecovery')

const updateSession = (sessionId, patch, writeDir) => {
  const session = sessionRecord.updateSession(sessionId, patch, writeDir)
  if (patch.archived !== true) return session

  const children = new Map()
  for (const item of listSessions(writeDir)) {
    if (!item.parentSessionId) continue
    if (!children.has(item.parentSessionId)) children.set(item.parentSessionId, [])
    children.get(item.parentSessionId).push(item)
  }
  const seen = new Set([sessionId])
  const pending = [sessionId]
  while (pending.length) {
    for (const child of children.get(pending.pop()) || []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      pending.push(child.id)
      if (!child.archived) sessionRecord.updateSession(child.id, { archived: true }, writeDir)
    }
  }
  return session
}

module.exports = {
  genId: sessionRecord.genId,
  emptyTotals: sessionRecord.emptyTotals,
  normalizeUsage: usageStore.normalizeUsage,
  withCwd: sessionRecord.withCwd,
  writeSession: sessionRecord.writeSession,
  createSession: sessionRecord.createSession,
  loadSession: sessionRecord.loadSession,
  loadSessionAsync: sessionRecord.loadSessionAsync,
  listSessions,
  listSessionsAsync,
  updateSession,
  ...runStore,
  readRecordPrompt,
  ...planStore,
  addToTotals: usageStore.addToTotals,
  recoverSession,
  rebuildTotals: usageStore.rebuildTotals,
  listRunUsage: usageStore.listRunUsage,
  listRunUsageAsync: usageStore.listRunUsageAsync,
}
