import { useEffect, useState } from 'react'
import api from '../../api'

const usePrompts = (providers) => {
  const [state, setState] = useState({ prompts: null, error: null, loading: true })
  const [revision, setRevision] = useState(0)
  const providerKey = JSON.stringify([...new Set(providers.map((item) => item.id))].sort())

  useEffect(() => {
    const controller = new AbortController()
    const scopes = [null, ...JSON.parse(providerKey)]
    setState((prev) => ({ ...prev, error: null, loading: true }))
    Promise.all(scopes.map((provider) => api.listPrompts({ signal: controller.signal, provider })))
      .then(([shared, ...versions]) => {
        if (controller.signal.aborted) return
        const byProvider = versions.map((data) => new Map((data.prompts || []).map((prompt) => [prompt.id, prompt])))
        setState({
          prompts: (shared.prompts || []).map((prompt) => ({
            ...prompt,
            versions: byProvider.map((items) => items.get(prompt.id)).filter(Boolean),
          })),
          error: null,
          loading: false,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [providerKey, revision])

  const refresh = () => setRevision((prev) => prev + 1)
  const replace = (prompt) => {
    setState((prev) => ({
      ...prev,
      prompts: prev.prompts?.map((item) => {
        if (item.id !== prompt.id) return item
        if (prompt.provider == null) return { ...item, ...prompt }
        return { ...item, versions: item.versions.map((version) => version.provider === prompt.provider ? prompt : version) }
      }),
    }))
    // Shared edits also change inherited text and built-in transformations.
    refresh()
  }

  return { ...state, replace, refresh }
}

export default usePrompts
