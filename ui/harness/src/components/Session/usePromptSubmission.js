import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api'

const storageKey = (sessionId) => `harness.promptSubmission.${sessionId}`

export const loadPromptSubmission = (sessionId) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(sessionId)) || 'null')
    return typeof saved?.request?.id === 'string' && typeof saved.request.prompt === 'string'
      && saved.context ? saved : null
  } catch {
    return null
  }
}

const savePending = (sessionId, pending) => {
  try {
    if (pending) sessionStorage.setItem(storageKey(sessionId), JSON.stringify(pending))
    else sessionStorage.removeItem(storageKey(sessionId))
  } catch {
    // The mounted composer still retains the prompt if browser storage is unavailable.
  }
}

const usePromptSubmission = ({ sessionId, submissions, connected, onSuccess }) => {
  const [pending, setPending] = useState(() => loadPromptSubmission(sessionId))
  const pendingRef = useRef(pending)
  const mounted = useRef(true)
  const sending = useRef(false)
  const [requestBusy, setRequestBusy] = useState(false)
  const [error, setError] = useState('')
  const callback = useRef(onSuccess)
  callback.current = onSuccess

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const updatePending = useCallback((next) => {
    pendingRef.current = next
    savePending(sessionId, next)
    setPending(next)
  }, [sessionId])

  const receive = useCallback((receipt) => {
    const current = pendingRef.current
    if (!mounted.current || !current || receipt?.id !== current.request.id) return
    if (receipt.status === 'received') {
      if (!current.received) updatePending({ ...current, received: true })
      setError('')
      return
    }
    if (!['succeeded', 'failed'].includes(receipt.status)) return
    if (receipt.status === 'succeeded') {
      // Clear the saved draft before navigation can unmount this composer.
      callback.current(receipt.result || {}, current)
      setError('')
    } else {
      setError(receipt.error || 'The prompt could not be sent. Your draft has been kept.')
    }
    updatePending(null)
  }, [updatePending])

  const transmit = useCallback(async (submission) => {
    if (sending.current) return
    sending.current = true
    setRequestBusy(true)
    setError('')
    try {
      const { submission: receipt } = await api.submitPrompt(sessionId, submission.request)
      receive(receipt)
    } catch (err) {
      if (!mounted.current || pendingRef.current?.request.id !== submission.request.id) return
      if (err.status >= 400 && err.status < 500) {
        updatePending(null)
        setError(err.message)
      } else {
        // A lost HTTP response does not mean the server rejected the prompt.
        setError('Could not confirm receipt. Your prompt is saved. Retry confirmation to check the same submission.')
      }
    } finally {
      sending.current = false
      if (mounted.current) setRequestBusy(false)
    }
  }, [sessionId, receive, updatePending])

  useEffect(() => {
    const receipt = submissions.find((item) => item.id === pending?.request.id)
    if (receipt) receive(receipt)
  }, [submissions, pending?.request.id, receive])

  useEffect(() => {
    if (!connected || !pendingRef.current || sending.current) return
    // Reposting the persisted ID recovers a lost acknowledgement without sending twice.
    void transmit(pendingRef.current)
  }, [connected, transmit])

  const submit = (request, context) => {
    if (pendingRef.current || sending.current) return
    const next = { request: { ...request, id: crypto.randomUUID() }, context, received: false }
    updatePending(next)
    void transmit(next)
  }

  const retry = () => {
    if (pendingRef.current) void transmit(pendingRef.current)
  }

  return { pending, requestBusy, error, submit, retry }
}

export default usePromptSubmission
