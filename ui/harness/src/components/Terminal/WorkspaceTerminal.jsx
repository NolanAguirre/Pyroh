import { useCallback, useEffect, useState } from 'react'
import { Button } from 'component-library'
import TerminalPanel from './TerminalPanel'
import ensureWorkspaceTerminal from './ensureWorkspaceTerminal'
import { connectionLabel, errorText } from './terminalUtils'
import './Terminal.css'
import './WorkspaceTerminal.css'

const WorkspaceTerminal = ({ workspace }) => {
  const [terminal, setTerminal] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const { id, cwd } = workspace

  useEffect(() => {
    let cancelled = false
    setTerminal(null)
    setStatus(null)
    setError(null)
    ensureWorkspaceTerminal(id, cwd)
      .then((next) => {
        if (!cancelled) setTerminal(next)
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err))
      })
    return () => { cancelled = true }
  }, [id, cwd, attempt])

  const onStatus = useCallback((terminalId, next) => setStatus(next), [])

  return (
    <section className="workspace-terminal" aria-label={`${workspace.name} terminal`}>
      <header className="workspace-terminal__header">
        <span className="workspace-terminal__title" title={cwd}>{workspace.name} · Terminal</span>
        {(error || status?.exited) ? (
          <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {error ? 'Retry' : 'New shell'}
          </Button>
        ) : (
          <span className="workspace-terminal__status" title={connectionLabel(status)}>
            {status?.connected ? '' : connectionLabel(status)}
          </span>
        )}
      </header>
      <div className="workspace-terminal__body">
        {terminal && (
          <TerminalPanel key={terminal.id} terminal={terminal} active focused={false} onStatus={onStatus} />
        )}
        {error && <p className="workspace-terminal__message" role="alert">{error}</p>}
      </div>
    </section>
  )
}

export default WorkspaceTerminal
