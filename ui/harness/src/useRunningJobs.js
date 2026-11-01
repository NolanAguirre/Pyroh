import { useCallback, useEffect, useState } from 'react'
import api from './api'

const JOB_LIST_LIMIT = 20

export const ACTIVE_JOB = (session) => session.status === 'running' || session.status === 'awaiting_input'

// Active jobs across all workspaces, filled up with recent chats.
const useRunningJobs = () => {
  const [runningJobs, setRunningJobs] = useState([])

  const loadRunningJobs = useCallback(() => {
    api
      .listSessions(null, false, { orderBy: 'createdAt', order: 'desc', active: true, limit: JOB_LIST_LIMIT })
      .then(async ({ sessions: activeJobs }) => {
        if (activeJobs.length >= JOB_LIST_LIMIT) {
          setRunningJobs(activeJobs)
          return
        }
        const { sessions: recentChats } = await api.listSessions(null, false, {
          orderBy: 'createdAt', order: 'desc', active: false, limit: JOB_LIST_LIMIT - activeJobs.length,
        })
        const activeIds = new Set(activeJobs.map(job => job.id))
        const byRecent = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id)
        setRunningJobs([...activeJobs, ...recentChats.filter(job => !activeIds.has(job.id))].sort(byRecent))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadRunningJobs()
  }, [loadRunningJobs])

  return { runningJobs, loadRunningJobs }
}

export default useRunningJobs
