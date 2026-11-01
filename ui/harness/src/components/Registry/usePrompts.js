import { useEffect, useState } from 'react'
import api from '../../api'

const usePrompts = () => {
  const [state, setState] = useState({ prompts: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    api
      .listPrompts({ signal: controller.signal })
      .then((data) => setState({ prompts: data.prompts || [], error: null }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState({ prompts: null, error: err.message })
      })
    return () => controller.abort()
  }, [])

  const replace = (prompt) => setState((prev) => ({
    ...prev,
    prompts: prev.prompts.map((item) => (item.id === prompt.id ? prompt : item)),
  }))

  return { ...state, replace }
}

export default usePrompts
