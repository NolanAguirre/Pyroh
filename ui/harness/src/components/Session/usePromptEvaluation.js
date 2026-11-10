import { useEffect, useState } from 'react'
import api from '../../api'

const usePromptEvaluation = (sessionId, request, revision) => {
  const payload = JSON.stringify(request)
  const key = JSON.stringify([sessionId, payload, revision])
  const [state, setState] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.evaluatePrompt(sessionId, JSON.parse(payload), { signal: controller.signal })
        .then(result => {
          if (!controller.signal.aborted) setState({ key, result })
        })
        .catch(error => {
          if (!controller.signal.aborted) setState({ key, error: error.message })
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId, payload, key])

  return state?.key === key ? state : { pending: true }
}

export default usePromptEvaluation
