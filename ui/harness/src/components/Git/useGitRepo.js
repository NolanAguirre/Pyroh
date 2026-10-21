import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api'

const POLL_MS = 4000
const NOT_A_REPO = 409

const messageOf = (err) => (err && err.message ? err.message : String(err))

const useGitRepo = (workspaceId) => {
  const [status, setStatusState] = useState(null)
  const [version, setVersion] = useState(0)
  const [branches, setBranches] = useState({ current: null, local: [], remote: [] })
  const [commits, setCommits] = useState([])
  const [loading, setLoading] = useState(true)
  const [notRepo, setNotRepo] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [output, setOutput] = useState(null)
  const busyRef = useRef(null)
  const workspaceRef = useRef(workspaceId)
  workspaceRef.current = workspaceId

  const setStatus = useCallback((next) => {
    setStatusState(next)
    setVersion((value) => value + 1)
  }, [])

  const loadStatus = useCallback(async () => {
    const id = workspaceId
    try {
      const next = await api.gitStatus(id)
      if (workspaceRef.current !== id) return
      setStatus(next)
      setNotRepo(false)
    } catch (err) {
      if (workspaceRef.current !== id) return
      if (err.status === NOT_A_REPO) {
        setNotRepo(true)
        setStatus(null)
      } else {
        setError(messageOf(err))
      }
    } finally {
      if (workspaceRef.current === id) setLoading(false)
    }
  }, [workspaceId, setStatus])

  const loadBranches = useCallback(async () => {
    const id = workspaceId
    try {
      const next = await api.gitBranches(id)
      if (workspaceRef.current === id) setBranches(next)
    } catch {
      // status reports the error
    }
  }, [workspaceId])

  const loadLog = useCallback(async () => {
    const id = workspaceId
    try {
      const { commits: list } = await api.gitLog(id)
      if (workspaceRef.current === id) setCommits(list)
    } catch {
      // status reports the error
    }
  }, [workspaceId])

  const refresh = useCallback(() => Promise.all([loadStatus(), loadBranches(), loadLog()]), [loadStatus, loadBranches, loadLog])

  useEffect(() => {
    setStatus(null)
    setBranches({ current: null, local: [], remote: [] })
    setCommits([])
    setLoading(true)
    setNotRepo(false)
    setError(null)
    setOutput(null)
    refresh()
  }, [refresh])

  useEffect(() => {
    const timer = setInterval(() => {
      if (busyRef.current || document.hidden) return
      loadStatus()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [loadStatus])

  const run = useCallback(async (name, fn, { reload = false } = {}) => {
    if (busyRef.current) return null
    busyRef.current = name
    setBusy(name)
    setError(null)
    try {
      const result = await fn()
      const nextStatus = result && (result.files ? result : result.status)
      if (nextStatus && nextStatus.files) setStatus(nextStatus)
      if (result && result.output) setOutput(result.output)
      if (reload) await Promise.all([loadBranches(), loadLog()])
      return result
    } catch (err) {
      setError(messageOf(err))
      return null
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [loadBranches, loadLog, setStatus])

  const stage = (paths = []) => run('stage', () => api.gitStage(workspaceId, paths))
  const unstage = (paths = []) => run('unstage', () => api.gitUnstage(workspaceId, paths))
  const discard = (paths) => run('discard', () => api.gitDiscard(workspaceId, paths))
  const commit = (message, amend) => run('commit', () => api.gitCommit(workspaceId, { message, amend }), { reload: true })
  const push = () => run('push', () => api.gitPush(workspaceId), { reload: true })
  const pull = () => run('pull', () => api.gitPull(workspaceId), { reload: true })
  const fetchRemotes = () => run('fetch', () => api.gitFetch(workspaceId), { reload: true })
  const checkout = (branch, options) => run('checkout', () => api.gitCheckout(workspaceId, branch, options), { reload: true })

  return {
    status,
    version,
    branches,
    commits,
    loading,
    notRepo,
    busy,
    error,
    output,
    clearError: () => setError(null),
    clearOutput: () => setOutput(null),
    refresh,
    stage,
    unstage,
    discard,
    commit,
    push,
    pull,
    fetchRemotes,
    checkout,
  }
}

export default useGitRepo
