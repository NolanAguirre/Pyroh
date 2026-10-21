import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, DevScope } from 'component-library'
import api from '../api'

const LogFold = ({ devId, sessionId, logPath, refreshKey, active, hasFailure }) => {
  const [log, setLog] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const request = useRef(0)

  const load = useCallback(async () => {
    const current = ++request.current
    try {
      const text = await api.getLog(sessionId)
      if (current !== request.current) return
      setLog(text)
      setError('')
    } catch (err) {
      if (current === request.current) setError(err.message || 'Could not load the daemon log')
    }
  }, [sessionId])

  useEffect(() => {
    setLog('')
    setError('')
    setCopied(false)
    return () => { request.current += 1 }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    load()
    const timer = active ? setInterval(load, 2000) : null
    return () => {
      if (timer) clearInterval(timer)
      request.current += 1
    }
  }, [sessionId, refreshKey, active, load])

  const copyLog = () => {
    if (!log) return
    navigator.clipboard?.writeText(log).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <DevScope id={devId} state={{ log: logPath }}>
      <div className="log-fold">
        {logPath && <p className="hint log-fold__path" title={logPath}>{logPath}</p>}
        <div className="log-fold__actions">
          <Button variant="ghost" size="sm" onClick={load} devId="hr8t5n0">
            Refresh
          </Button>
          {log && (
            <Button variant="ghost" size="sm" onClick={copyLog} devId="m2x7f9a">
              {copied ? 'Copied' : 'Copy'}
            </Button>
          )}
        </div>
        {error && <p className="hint hint--error">Could not load daemon log: {error}</p>}
        <pre className="log-fold__pre">{log || (hasFailure
          ? 'No daemon output was captured for this session. See the run error in the transcript; older startup failures may have occurred before logging began.'
          : 'No daemon output yet.')}</pre>
      </div>
    </DevScope>
  )
}

export default LogFold
