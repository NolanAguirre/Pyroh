import { useEffect, useState } from 'react'
import api from '../../api'

const useExplain = (workspaceId, provider) => {
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .explainRegistry(workspaceId || null, { provider: provider || undefined }, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [workspaceId, provider, refreshToken])

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) }
}

export default useExplain
