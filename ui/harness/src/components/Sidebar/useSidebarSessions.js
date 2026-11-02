import { useEffect, useMemo, useState } from 'react'

export const LATEST_KEPT = 10
const ARCHIVED_PAGE = 50

const byLatest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(a.id).localeCompare(String(b.id))

const useSidebarSessions = ({ sessions, searchQuery, showArchived, workspaceId }) => {
  const [archivedLimit, setArchivedLimit] = useState(ARCHIVED_PAGE)

  useEffect(() => {
    setArchivedLimit(ARCHIVED_PAGE)
  }, [showArchived, searchQuery, workspaceId])

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const searchingSessionId = query.startsWith('s_')
    const matched = query
      ? sessions.filter((s) => {
        const name = (s.name || '').toLowerCase()
        const provider = (s.provider || '').toLowerCase()
        const model = (s.model || '').toLowerCase()
        const id = (s.id || '').toLowerCase()
        if (searchingSessionId) return id.includes(query)
        return name.includes(query) || provider.includes(query) || model.includes(query) || id.includes(query)
      })
      : sessions
    return [...matched].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }, [sessions, searchQuery])

  const { mainSessions, archivedSessions } = useMemo(() => ({
    mainSessions: filteredSessions.filter(s => s.pinned || !s.archived),
    archivedSessions: filteredSessions.filter(s => !s.pinned && s.archived),
  }), [filteredSessions])
  const shownSessions = [...mainSessions, ...archivedSessions.slice(0, archivedLimit)]
  const hiddenArchived = Math.max(0, archivedSessions.length - archivedLimit)

  const sessionsToArchive = useMemo(() => {
    const unpinned = sessions
      .filter(session => !session.pinned && !session.archived)
      .sort(byLatest)
    const byId = new Map(unpinned.map(session => [session.id, session]))
    const rootOf = (session) => {
      const seen = new Set()
      let current = session
      while (current.parentSessionId && byId.has(current.parentSessionId) && !seen.has(current.id)) {
        seen.add(current.id)
        current = byId.get(current.parentSessionId)
      }
      return current.id
    }
    const keptRoots = new Set(unpinned.slice(0, LATEST_KEPT).map(rootOf))
    return unpinned.filter(session => !keptRoots.has(rootOf(session)))
  }, [sessions])

  const showMoreArchived = () => setArchivedLimit(limit => limit + ARCHIVED_PAGE)

  return { filteredSessions, shownSessions, hiddenArchived, sessionsToArchive, showMoreArchived }
}

export default useSidebarSessions
