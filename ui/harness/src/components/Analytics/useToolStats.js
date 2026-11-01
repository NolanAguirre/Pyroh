import { useEffect, useState } from 'react'
import api from '../../api'

const useToolStats = (params) => {
  const key = JSON.stringify(params)
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ stats: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .getToolStats(JSON.parse(key), { signal: controller.signal })
      .then(({ stats }) => setState({ stats, error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [key, refreshToken])

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) }
}

export default useToolStats
