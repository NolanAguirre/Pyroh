import { useEffect, useRef, useState } from 'react'
import api from './api'

// Subscribe to a session's SSE stream. Returns the accumulated transcript
// events, the live session record, its runs, and pending questions.
const useSessionEvents = (sessionId) => {
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [runs, setRuns] = useState([])
  const [questions, setQuestions] = useState([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef(null)

  useEffect(() => {
    setEvents([])
    setSession(null)
    setRuns([])
    setQuestions([])
    setConnected(false)
    if (!sessionId) return undefined

    const source = new EventSource(api.eventsUrl(sessionId))
    sourceRef.current = source

    source.addEventListener('event', (e) => {
      const raw = JSON.parse(e.data)
      const event = raw.session ? { ...raw, session: api.adoptSession(sessionId, raw.session) } : raw
      setEvents((prev) => [...prev, event])
    })
    source.addEventListener('session', (e) => setSession(api.adoptSession(sessionId, JSON.parse(e.data))))
    source.addEventListener('runs', (e) => setRuns(JSON.parse(e.data)))
    source.addEventListener('questions', (e) => setQuestions(JSON.parse(e.data)))
    source.addEventListener('ready', () => setConnected(true))
    source.onerror = () => setConnected(false)

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [sessionId])

  const pendingQuestions = questions.filter((q) => q.status === 'pending')

  return { events, session, runs, questions, pendingQuestions, connected }
}

export default useSessionEvents
