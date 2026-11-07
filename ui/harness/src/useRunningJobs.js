import { useCallback, useEffect, useRef, useState } from 'react'
import api from './api'

const JOB_LIST_LIMIT = 20

export const ACTIVE_JOB = (session) => session.status === 'running' || session.status === 'awaiting_input' || session.status === 'subagent'

// Active jobs across all workspaces, filled up with recent chats.
const useRunningJobs = () => {
  const [runningJobs, setRunningJobs] = useState([])
  const inFlight = useRef(null)

  const loadRunningJobs = useCallback(() => {
    if (inFlight.current) return inFlight.current
    inFlight.current = api
      .listSessions(null, false, { orderBy: 'updatedAt', order: 'desc', active: true, limit: JOB_LIST_LIMIT })
      .then(async ({ sessions: activeJobs }) => {
        if (activeJobs.length >= JOB_LIST_LIMIT) {
          setRunningJobs(activeJobs)
          return
        }
        const { sessions: recentChats } = await api.listSessions(null, false, {
          orderBy: 'updatedAt', order: 'desc', active: false, limit: JOB_LIST_LIMIT - activeJobs.length,
        })
        const activeIds = new Set(activeJobs.map(job => job.id))
        const lastInteraction = (job) => job.updatedAt || job.createdAt || 0
        const byRecent = (a, b) => lastInteraction(b) - lastInteraction(a) || a.id.localeCompare(b.id)
        setRunningJobs([...activeJobs, ...recentChats.filter(job => !activeIds.has(job.id))].sort(byRecent))
      })
      .catch(() => {})
      .finally(() => { inFlight.current = null })
    return inFlight.current
  }, [])

  useEffect(() => {
    loadRunningJobs()
  }, [loadRunningJobs])

  return { runningJobs, loadRunningJobs }
}

export default useRunningJobs
