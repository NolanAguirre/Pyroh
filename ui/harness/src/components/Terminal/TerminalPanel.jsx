import { useCallback, useEffect, useRef, useState } from 'react'
import { DevScope, Terminal } from 'component-library'
import useTerminalSocket from './useTerminalSocket'

const TerminalPanel = ({ terminal, active, focused = active, onStatus, onName }) => {
  const termRef = useRef(null)
  const [size, setSize] = useState(null)
  const socket = useTerminalSocket(terminal.id, termRef, onName)
  const { connected, exited, exitCode, input, resize } = socket

  useEffect(() => {
    onStatus(terminal.id, { connected, exited, exitCode, cols: size?.cols, rows: size?.rows })
  }, [onStatus, terminal.id, connected, exited, exitCode, size])

  const handleResize = useCallback((next) => {
    setSize(next)
    resize(next)
  }, [resize])

  return (
    <DevScope id="zpeg8it" state={{ terminal: terminal.id, active, connected, exited }}>
      <div className={`terminal-panel${active ? '' : ' terminal-panel--hidden'}`}>
        <Terminal
          devId="9vinm3q"
          ref={termRef}
          focused={focused}
          onData={input}
          onResize={handleResize}
          className="terminal-panel__xterm"
        />
      </div>
    </DevScope>
  )
}

export default TerminalPanel
