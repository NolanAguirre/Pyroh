import { useEffect, useState } from 'react'
import api from './api'

// Modes and panels allowed for the active workspace.
const useRegistry = (workspaceId) => {
  const [registry, setRegistry] = useState({ modes: [], panels: [] })

  useEffect(() => {
    let cancelled = false
    api
      .getRegistry(workspaceId)
      .then((data) => {
        if (cancelled) return
        setRegistry({
          modes: Array.isArray(data.modes) ? data.modes : [],
          panels: Array.isArray(data.panels) ? data.panels : [],
        })
      })
      .catch(() => { if (!cancelled) setRegistry({ modes: [], panels: [] }) })
    return () => { cancelled = true }
  }, [workspaceId])

  return registry
}

export default useRegistry
