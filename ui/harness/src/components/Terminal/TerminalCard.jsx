import { useCallback, useEffect, useState } from 'react'
import { Button } from 'component-library'
import api from '../../api'
import { urlWithSelection } from '../../appUrl'
import TerminalPanel from './TerminalPanel'
import PreparedTerminalCommand from './PreparedTerminalCommand'
import { connectionLabel, errorText } from './terminalUtils'
import './Terminal.css'
import './TerminalCard.css'

const TerminalCard = ({ view }) => {
  const [expanded, setExpanded] = useState(true)
  const [terminal, setTerminal] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [expired, setExpired] = useState(false)
  const [closing, setClosing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { resourceId, workspaceId, sessionId } = view

  useEffect(() => {
    if (!expanded) return undefined
    const controller = new AbortController()
    setTerminal(null)
    setStatus(null)
    setError(null)
    api.getPreparedTerminal(resourceId, workspaceId, sessionId, { signal: controller.signal })
      .then(({ terminal: next }) => {
        if (controller.signal.aborted) return
        if (next?.id !== resourceId || next.workspaceId !== workspaceId || next.sessionId !== sessionId) {
          throw new Error('This terminal does not belong to this chat')
        }
        setTerminal(next)
        setExpired(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (err.status === 404 || err.status === 410) setExpired(true)
        else setError(errorText(err))
      })
    return () => controller.abort()
  }, [resourceId, workspaceId, sessionId, expanded, attempt])

  const onStatus = useCallback((_id, next) => setStatus(next), [])
  const onName = useCallback((_id, name) => setTerminal((current) => current ? { ...current, name } : current), [])

  const close = async () => {
    if (closing) return
    setClosing(true)
    setError(null)
    try {
      await api.getPreparedTerminal(resourceId, workspaceId, sessionId)
      await api.killTerminal(resourceId)
      setTerminal(null)
      setExpired(true)
    } catch (err) {
      if (err.status === 404 || err.status === 410) {
        setTerminal(null)
        setExpired(true)
      } else setError(errorText(err))
    } finally {
      setClosing(false)
    }
  }

  const href = urlWithSelection(new URL(window.location.href), workspaceId, sessionId, 'terminal', null, resourceId).href
  const ended = expired || terminal?.exited || status?.exited

  return (
    <section className="terminal-card column" aria-label={terminal?.name || view.name || 'Terminal'}>
      <header className="terminal-card__header row card-section">
        <strong className="terminal-card__title">{terminal?.name || view.name || 'Terminal'}</strong>
        <span className="terminal-card__status">{expired ? 'Terminal closed or expired' : ended ? 'Exited' : expanded && terminal ? connectionLabel(status) : expanded ? 'Loading…' : 'Collapsed'}</span>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
        {!expired && <a className="terminal-card__open" href={href} target="_blank" rel="noreferrer">Open terminal view</a>}
        {terminal && !expired && <Button variant="ghost" size="sm" disabled={closing} onClick={close}>Close terminal</Button>}
      </header>
      {expanded && (
        <>
          <div className="terminal-card__cwd card-section">{terminal?.cwd || view.cwd}</div>
          {error && (
            <div className="terminal-card__error row card-section" role="alert">
              <span>{error}</span>
              <Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>
            </div>
          )}
          {expired && <p className="terminal-card__message card-section">This terminal is no longer available.</p>}
          {terminal && !expired && (
            <>
              <PreparedTerminalCommand terminal={terminal} disabled={!status?.connected || Boolean(ended) || closing} onChange={setTerminal} />
              <div className="terminal-card__body">
                <TerminalPanel terminal={terminal} active focused={false} onStatus={onStatus} onName={onName} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

export default TerminalCard
