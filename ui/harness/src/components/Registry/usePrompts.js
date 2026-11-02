import { useEffect, useState } from 'react'
import api from '../../api'

const usePrompts = (provider = null) => {
  const [state, setState] = useState({ prompts: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    api
      .listPrompts({ signal: controller.signal, provider })
      .then((data) => {
        if (!controller.signal.aborted) setState({ prompts: data.prompts || [], error: null })
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState({ prompts: null, error: err.message })
      })
    return () => controller.abort()
  }, [provider])

  const replace = (prompt) => setState((prev) => ({
    ...prev,
    prompts: prev.prompts.map((item) => (item.id === prompt.id ? prompt : item)),
  }))

  return { ...state, replace }
}

export default usePrompts
