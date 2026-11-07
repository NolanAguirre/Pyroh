import { useCallback, useEffect, useRef, useState } from 'react'
import api from './api'

const sameSessionRow = (a, b) => a.updatedAt === b.updatedAt
  && a.status === b.status
  && a.name === b.name
  && Boolean(a.pinned) === Boolean(b.pinned)
  && Boolean(a.archived) === Boolean(b.archived)

// These descendants are archived by the server; token-waste sources need separate requests.
const descendantIds = (sessions, rootIds) => {
  const children = new Map()
  for (const item of sessions) {
    if (!item.parentSessionId || item.childKind === 'fork') continue
    if (!children.has(item.parentSessionId)) children.set(item.parentSessionId, [])
    children.get(item.parentSessionId).push(item.id)
  }
  const ids = new Set(rootIds)
  const pending = [...ids]
  while (pending.length) {
    for (const childId of children.get(pending.pop()) || []) {
      if (ids.has(childId)) continue
      ids.add(childId)
      pending.push(childId)
    }
  }
  return ids
}

// Sessions for the active workspace plus rename, archive, and pin actions.
// `leaveSession` runs when the active session gets hidden by archiving.
const useWorkspaceSessions = (activeWorkspaceId, activeId, leaveSession, searchingSessionId = false) => {
  const [sessions, setSessions] = useState([])
  const [sessionsReadyFor, setSessionsReadyFor] = useState(null)
  const [sessionsHaveArchived, setSessionsHaveArchived] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const includeArchived = showArchived || searchingSessionId
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState(null)
  const sessionsRequest = useRef(0)
  const inFlight = useRef(null)

  const loadSessions = useCallback(() => {
    if (!activeWorkspaceId) {
      sessionsRequest.current += 1
      inFlight.current = null
      setSessions([])
      setSessionsReadyFor(null)
      return
    }
    const workspaceId = activeWorkspaceId
    const key = `${workspaceId}:${includeArchived}`
    if (inFlight.current?.key === key) return inFlight.current.promise
    const request = ++sessionsRequest.current
    const promise = api
      .listSessions(workspaceId, includeArchived)
      .then(({ sessions: list }) => {
        if (request !== sessionsRequest.current) return
        setSessions(prev => {
          const byId = new Map(prev.map(item => [item.id, item]))
          return list.map(item => {
            const old = byId.get(item.id)
            return old && sameSessionRow(old, item) ? old : item
          })
        })
        setSessionsHaveArchived(includeArchived)
        setSessionsReadyFor(workspaceId)
      })
      .catch(() => {
        if (request !== sessionsRequest.current) return
        setSessions([])
        setSessionsReadyFor(null)
      })
      .finally(() => {
        if (inFlight.current?.request === request) inFlight.current = null
      })
    inFlight.current = { key, request, promise }
    return promise
  }, [activeWorkspaceId, includeArchived])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const addSession = (session) => {
    setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
    setSessionsReadyFor(activeWorkspaceId)
  }

  const renameSession = async (id, name) => {
    const { session } = await api.setSessionName(id, name)
    setSessions(current => current.map(item => item.id === id ? { ...item, ...session } : item))
    return session
  }

  const archiveSessions = async (ids) => {
    if (archiveBusy || !ids.length) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const requested = new Set()
      const archivedIds = new Set()
      let pending = [...new Set(ids)]
      let failure = null
      while (pending.length) {
        pending.forEach(id => requested.add(id))
        const results = await Promise.allSettled(pending.map(id => api.setSessionArchived(id, true)))
        const archived = results.flatMap(result => result.status === 'fulfilled' ? [result.value.session] : [])
        failure ||= results.find(result => result.status === 'rejected')
        const batchIds = descendantIds(sessions, archived.map(session => session.id))
        batchIds.forEach(id => archivedIds.add(id))
        if (archived.length) {
          const byId = new Map(archived.map(session => [session.id, session]))
          setSessions(current => {
            const currentIds = descendantIds(current, archived.map(session => session.id))
            return current.map(item => byId.get(item.id)
              || (currentIds.has(item.id) ? { ...item, archived: true } : item))
          })
        }
        pending = sessions.filter(item => item.mode === 'token-waste'
          && archivedIds.has(item.sourceSessionId)
          && !archivedIds.has(item.id)
          && !requested.has(item.id)).map(item => item.id)
      }
      if (!showArchived && archivedIds.has(activeId)) leaveSession()
      if (failure) setArchiveError(failure.reason?.message || 'Failed to archive sessions')
    } catch (error) { setArchiveError(error.message) }
    finally { setArchiveBusy(false) }
  }

  const archiveSession = async (id, archived) => {
    if (archived) return archiveSessions([id])
    if (archiveBusy) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const { session } = await api.setSessionArchived(id, false)
      setSessions(current => current.map(item => item.id === id ? session : item))
    } catch (error) { setArchiveError(error.message) }
    finally { setArchiveBusy(false) }
  }

  const archiveOlderSessions = (ids) => archiveSessions(ids)

  const pinSession = async (id, pinned) => {
    if (pinBusy) return
    setPinBusy(true)
    setPinError(null)
    try {
      const { session } = await api.setSessionPinned(id, pinned)
      setSessions(current => current.map(item => item.id === id ? session : item))
    } catch (error) { setPinError(error.message) }
    finally { setPinBusy(false) }
  }

  return {
    sessions,
    sessionsReadyFor,
    sessionsHaveArchived,
    showArchived,
    setShowArchived,
    archiveBusy,
    archiveError,
    pinBusy,
    pinError,
    loadSessions,
    addSession,
    renameSession,
    archiveSession,
    archiveOlderSessions,
    pinSession,
  }
}

export default useWorkspaceSessions
