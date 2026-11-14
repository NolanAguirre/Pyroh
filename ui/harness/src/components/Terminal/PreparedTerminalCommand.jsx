import { useEffect, useRef, useState } from 'react'
import { Button } from 'component-library'
import api from '../../api'
import { errorText } from './terminalUtils'
import './PreparedTerminalCommand.css'

const PreparedTerminalCommand = ({ terminal, disabled = false, onChange }) => {
  const [command, setCommand] = useState(terminal.preparedCommand || '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const submitting = useRef(false)

  useEffect(() => {
    setCommand(terminal.preparedCommand || '')
    setError(null)
  }, [terminal.id, terminal.preparedCommand])

  const run = async (event) => {
    event.preventDefault()
    if (submitting.current || disabled || terminal.exited || terminal.preparedState !== 'pending' || !command.trim()) return
    submitting.current = true
    setRunning(true)
    setError(null)
    try {
      const result = await api.runPreparedTerminal(terminal.id, terminal.workspaceId, terminal.sessionId, command)
      onChange(result.terminal)
    } catch (err) {
      setError(errorText(err))
      try {
        const result = await api.getPreparedTerminal(terminal.id, terminal.workspaceId, terminal.sessionId)
        onChange(result.terminal)
      } catch {
        // The run endpoint also prevents duplicate submission after a lost response.
      }
    } finally {
      submitting.current = false
      setRunning(false)
    }
  }

  return (
    <form className="prepared-terminal column card-section" onSubmit={run}>
      {terminal.preparedState === 'pending' ? (
        <>
          <label className="prepared-terminal__label">
            Command
            <textarea
              className="text-input prepared-terminal__command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              disabled={disabled || running || terminal.exited}
              spellCheck={false}
              rows={2}
            />
          </label>
          <div className="prepared-terminal__actions row">
            <span className="prepared-terminal__hint">Ready when you are. Enter passwords directly in the terminal.</span>
            <Button type="submit" variant="primary" size="sm" disabled={disabled || running || terminal.exited || !command.trim()}>
              {running ? 'Sending…' : 'Run'}
            </Button>
          </div>
        </>
      ) : (
        <p className="prepared-terminal__hint">Command sent. Continue in the terminal below.</p>
      )}
      {error && <p className="prepared-terminal__error" role="alert">{error}</p>}
    </form>
  )
}

export default PreparedTerminalCommand
