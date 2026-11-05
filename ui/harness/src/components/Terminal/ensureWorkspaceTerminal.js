import api from '../../api'
import { DEFAULT_SIZE } from './terminalUtils'

const pending = new Map()
const terminalIds = new Map()

const storedId = (key) => {
  if (terminalIds.has(key)) return terminalIds.get(key)
  try {
    return localStorage.getItem(key)
  } catch {
    return terminalIds.get(key)
  }
}

const rememberId = (key, id) => {
  terminalIds.set(key, id)
  try {
    localStorage.setItem(key, id)
  } catch {
    // Keep the workspace shell reusable when browser storage is unavailable.
  }
}

const ensureWorkspaceTerminal = (workspaceId, cwd) => {
  const key = `harness.workspace-terminal:${JSON.stringify([workspaceId, cwd])}`
  if (pending.has(key)) return pending.get(key)

  const ensure = async () => {
    const id = storedId(key)
    if (id) {
      const { terminals } = await api.listTerminals(workspaceId)
      const existing = terminals?.find((item) => item.id === id && item.workspaceId === workspaceId && !item.exited)
      if (existing) return existing
    }

    const { terminal } = await api.createTerminal(workspaceId, DEFAULT_SIZE)
    if (!terminal?.id) throw new Error('Unexpected response creating workspace terminal')
    rememberId(key, terminal.id)
    return terminal
  }

  // Share creation across mounts and, where supported, browser tabs.
  const request = (navigator.locks
    ? navigator.locks.request(key, ensure)
    : ensure()
  ).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

export default ensureWorkspaceTerminal
