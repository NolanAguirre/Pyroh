const sessionRecord = require('./sessionRecord')
const { listSessions, listSessionsAsync } = require('./sessionList')
const { readRecordPrompt } = require('./recordPrompt')
const runStore = require('./runStore')
const planStore = require('./planStore')
const usageStore = require('./usageStore')
const { recoverSession } = require('./sessionRecovery')

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
  updateSession: sessionRecord.updateSession,
  ...runStore,
  readRecordPrompt,
  ...planStore,
  addToTotals: usageStore.addToTotals,
  recoverSession,
  rebuildTotals: usageStore.rebuildTotals,
  listRunUsage: usageStore.listRunUsage,
  listRunUsageAsync: usageStore.listRunUsageAsync,
}
