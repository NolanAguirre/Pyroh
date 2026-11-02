const ACTIVE = new Set(['running', 'awaiting_input', 'queued'])

const childrenByParent = (sessions) => {
  const children = new Map()
  for (const session of sessions) {
    if (!session.parentSessionId || session.childKind === 'fork') continue
    if (!children.has(session.parentSessionId)) children.set(session.parentSessionId, [])
    children.get(session.parentSessionId).push(session)
  }
  return children
}

const hasActiveDescendant = (id, children, seen = new Set()) => {
  if (seen.has(id)) return false
  seen.add(id)
  return (children.get(id) || []).some((child) => ACTIVE.has(child.status) || hasActiveDescendant(child.id, children, seen))
}

// An idle parent with live child agents is waiting on them.
export const displayStatuses = (sessions = []) => {
  const children = childrenByParent(sessions)
  const statuses = new Map()
  for (const session of sessions) {
    const status = session.status || 'idle'
    statuses.set(session.id, status === 'idle' && hasActiveDescendant(session.id, children) ? 'subagent' : status)
  }
  return statuses
}

export const displayStatus = (session, sessions = []) => {
  const status = session?.status || 'idle'
  if (status !== 'idle' || !session?.id) return status
  return hasActiveDescendant(session.id, childrenByParent(sessions)) ? 'subagent' : status
}
