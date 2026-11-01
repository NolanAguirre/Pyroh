import { useCallback, useEffect, useRef, useState } from 'react'
import api from './api'

const sameSessionRow = (a, b) => a.updatedAt === b.updatedAt
  && a.status === b.status
  && a.name === b.name
  && Boolean(a.pinned) === Boolean(b.pinned)
  && Boolean(a.archived) === Boolean(b.archived)

// Sessions for the active workspace plus rename, archive, and pin actions.
// `leaveSession` runs when the active session gets hidden by archiving.
const useWorkspaceSessions = (activeWorkspaceId, activeId, leaveSession) => {
  const [sessions, setSessions] = useState([])
  const [sessionsReadyFor, setSessionsReadyFor] = useState(null)
  const [sessionsHaveArchived, setSessionsHaveArchived] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState(null)
  const sessionsRequest = useRef(0)

  const loadSessions = useCallback(() => {
    if (!activeWorkspaceId) {
      setSessions([])
      setSessionsReadyFor(null)
      return
    }
    const workspaceId = activeWorkspaceId
    const request = ++sessionsRequest.current
    api
      .listSessions(workspaceId, showArchived)
      .then(({ sessions: list }) => {
        if (request !== sessionsRequest.current) return
        setSessions(prev => {
          const byId = new Map(prev.map(item => [item.id, item]))
          return list.map(item => {
            const old = byId.get(item.id)
            return old && sameSessionRow(old, item) ? old : item
          })
        })
        setSessionsHaveArchived(showArchived)
        setSessionsReadyFor(workspaceId)
      })
      .catch(() => {
        if (request !== sessionsRequest.current) return
        setSessions([])
        setSessionsReadyFor(null)
      })
  }, [activeWorkspaceId, showArchived])

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

  const archiveSession = async (id, archived) => {
    if (archiveBusy) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const { session } = await api.setSessionArchived(id, archived)
      setSessions(current => current.map(item => item.id === id ? session : item))
      if (archived && !showArchived && activeId === id) leaveSession()
    } catch (error) { setArchiveError(error.message) }
    finally { setArchiveBusy(false) }
  }

  const archiveOlderSessions = async (ids) => {
    if (archiveBusy || !ids.length) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const results = await Promise.allSettled(ids.map(id => api.setSessionArchived(id, true)))
      const archived = results.flatMap(result => result.status === 'fulfilled' ? [result.value.session] : [])
      const failure = results.find(result => result.status === 'rejected')
      if (archived.length) {
        const byId = new Map(archived.map(session => [session.id, session]))
        setSessions(current => current.map(item => byId.get(item.id) || item))
        if (!showArchived && archived.some(session => session.id === activeId)) {
          leaveSession()
        }
      }
      if (failure) setArchiveError(failure.reason && failure.reason.message ? failure.reason.message : 'Failed to archive sessions')
    } finally {
      setArchiveBusy(false)
    }
  }

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
