import { useCallback, useEffect, useRef, useState } from 'react'

export const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message || `Request failed (${response.status})`)
  if (!data) throw new Error('The analytics API returned an empty or invalid response.')
  return data
}

export const useReplay = () => {
  const [replay, setReplay] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)
  useEffect(() => () => request.current?.abort(), [])
  const load = useCallback(async (sessionId, assumptions) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setReplay(null)
    try {
      const data = await fetchJson(`/analytics/api/sessions/${encodeURIComponent(sessionId)}/subagent-replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assumptions }),
        signal: controller.signal,
      })
      if (data.replay?.version !== 4 || !Array.isArray(data.replay.blocks) || !Array.isArray(data.replay.replayTurns)) {
        throw new Error('This visualizer needs a complete version 4 replay from the analytics API.')
      }
      if (!controller.signal.aborted) setReplay(data.replay)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])
  return { replay, loading, error, load }
}
