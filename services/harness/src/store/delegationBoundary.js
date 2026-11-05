const { loadSession, updateSession } = require('./sessionRecord')

const isDelegatedChild = (session) => Boolean(session?.parentRunId) &&
  session.childKind !== 'workflow' && !session.delegationDetached

// Keep ancestry for navigation and depth limits, but freeze the work owned by
// the original parent before accepting a user's independent conversation.
const detachDelegation = (session, runs, writeDir) => {
  if (!isDelegatedChild(session) || !runs.length) return session
  return require('../harness/delegation').withDeliveryLock(session.id, () => {
    const current = loadSession(session.id, writeDir)
    if (!isDelegatedChild(current)) return current
    return updateSession(session.id, {
      delegationDetached: {
        at: Date.now(),
        runIds: runs.filter(run => run.endedAt).map(run => run.id),
        cancelled: Boolean(current.stopRequestedAt || current.status === 'stopped'),
        // Steering takes over an unfinished turn; its eventual answer belongs
        // to the user, so it must not trigger a result delivery to the parent.
        suppressReturn: runs.some(run => !run.endedAt),
      },
      stopRequestedAt: null,
    }, writeDir)
  })
}

module.exports = { isDelegatedChild, detachDelegation }
