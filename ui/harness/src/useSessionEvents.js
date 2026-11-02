import { useEffect, useRef, useState } from 'react'
import api from './api'

// Subscribe to a session's SSE stream. Returns the accumulated transcript
// events, the live session record, its runs, and pending questions.
const useSessionEvents = (sessionId) => {
  const [events, setEvents] = useState([])
  const [session, setSession] = useState(null)
  const [runs, setRuns] = useState([])
  const [children, setChildren] = useState([])
  const [questions, setQuestions] = useState([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef(null)

  useEffect(() => {
    setEvents([])
    setSession(null)
    setRuns([])
    setQuestions([])
    setChildren([])
    setConnected(false)
    if (!sessionId) return undefined

    const source = new EventSource(api.eventsUrl(sessionId))
    sourceRef.current = source
    let queuedEvents = []
    let flushTimer = null
    let lastOffset = 0
    const flushEvents = () => {
      clearTimeout(flushTimer)
      flushTimer = null
      if (!queuedEvents.length) return
      const batch = queuedEvents
      queuedEvents = []
      setEvents(prev => [...prev, ...batch])
    }

    source.addEventListener('event', (e) => {
      const offset = Number(e.lastEventId)
      if (offset && offset <= lastOffset) return
      const raw = JSON.parse(e.data)
      const event = raw.session ? { ...raw, session: api.adoptSession(sessionId, raw.session) } : raw
      if (offset) lastOffset = offset
      queuedEvents.push(event)
      if (flushTimer === null) flushTimer = setTimeout(flushEvents, 32)
    })
    source.addEventListener('reset', () => {
      clearTimeout(flushTimer)
      flushTimer = null
      queuedEvents = []
      lastOffset = 0
      setEvents([])
    })
    source.addEventListener('session', (e) => setSession(api.adoptSession(sessionId, JSON.parse(e.data))))
    source.addEventListener('runs', (e) => setRuns(JSON.parse(e.data)))
    source.addEventListener('children', (e) => setChildren(JSON.parse(e.data).map(child => {
      const tagged = api.adoptSession(sessionId, { id: child.sessionId, workspaceId: child.workspaceId })
      return { ...child, sessionId: tagged.id, workspaceId: tagged.workspaceId }
    })))
    source.addEventListener('questions', (e) => setQuestions(JSON.parse(e.data)))
    source.addEventListener('ready', () => {
      flushEvents()
      setConnected(true)
    })
    source.onerror = () => setConnected(false)

    return () => {
      clearTimeout(flushTimer)
      source.close()
      sourceRef.current = null
    }
  }, [sessionId])

  const pendingQuestions = questions.filter((q) => q.status === 'pending')

  return { events, session, runs, children, questions, pendingQuestions, connected }
}

export default useSessionEvents
