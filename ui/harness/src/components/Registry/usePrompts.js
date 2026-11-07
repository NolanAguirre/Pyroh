import { useEffect, useState } from 'react'
import api from '../../api'

const usePrompts = ({ provider, model, mode }) => {
  const scopeKey = JSON.stringify([provider, model, mode])
  const [state, setState] = useState({ scopeKey: null, prompts: null, models: [], modes: [], error: null, loading: true })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({
      ...prev,
      scopeKey,
      prompts: prev.scopeKey === scopeKey ? prev.prompts : null,
      error: null,
      loading: true,
    }))
    api.listPrompts({ signal: controller.signal, provider, model, mode })
      .then((data) => {
        if (controller.signal.aborted) return
        setState({ scopeKey, prompts: data.prompts || [], models: data.models || [], modes: data.modes || [], error: null, loading: false })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [provider, model, mode, scopeKey, revision])

  const refresh = () => setRevision((prev) => prev + 1)
  const replace = (prompt) => {
    setState((prev) => prev.scopeKey !== scopeKey ? prev : {
      ...prev,
      prompts: prev.prompts?.map((item) => item.id === prompt.id ? prompt : item),
    })
  }

  // Never render the previous scope's text while the new request starts.
  return {
    ...state,
    ...(state.scopeKey !== scopeKey ? { prompts: null, error: null, loading: true } : {}),
    replace,
    refresh,
    scopeKey,
  }
}

export default usePrompts
