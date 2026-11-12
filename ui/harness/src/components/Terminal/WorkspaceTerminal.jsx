import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from 'component-library'
import api from '../../api'
import TabStrip from '../TabStrip/tabStrip'
import TerminalPanel from './TerminalPanel'
import ensureWorkspaceTerminal from './ensureWorkspaceTerminal'
import { DEFAULT_SIZE, connectionLabel, errorText } from './terminalUtils'
import './Terminal.css'
import './WorkspaceTerminal.css'

const WorkspaceTerminal = ({ workspace }) => {
  const [terminals, setTerminals] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const { id, cwd } = workspace
  const status = statuses[activeId]

  useEffect(() => {
    let cancelled = false
    setTerminals([])
    setActiveId(null)
    setStatuses({})
    setLoading(true)
    setError(null)
    ensureWorkspaceTerminal(id, cwd)
      .then(async (next) => {
        const { terminals: list } = await api.listTerminals(id)
        if (cancelled) return
        const existing = (Array.isArray(list) ? list : []).filter((item) => item.workspaceId === id && !item.exited)
        setTerminals(existing.some((item) => item.id === next.id) ? existing : [...existing, next])
        setActiveId(next.id)
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [id, cwd, attempt])

  const onStatus = useCallback((terminalId, next) => {
    setStatuses((prev) => ({ ...prev, [terminalId]: next }))
  }, [])

  const onName = useCallback((terminalId, name) => {
    if (typeof name !== 'string' || !name) return
    setTerminals((prev) => prev.map((item) => item.id === terminalId ? { ...item, name } : item))
  }, [])

  const create = async () => {
    if (creatingRef.current || loading) return
    creatingRef.current = true
    setCreating(true)
    setError(null)
    try {
      const size = status?.cols && status?.rows ? { cols: status.cols, rows: status.rows } : DEFAULT_SIZE
      const { terminal } = await api.createTerminal(id, size)
      if (!terminal?.id) throw new Error('Unexpected response creating workspace terminal')
      setTerminals((prev) => [...prev, terminal])
      setActiveId(terminal.id)
    } catch (err) {
      setError(errorText(err))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  return (
    <section className="workspace-terminal" aria-label={`${workspace.name} terminal`}>
      <header className="workspace-terminal__header">
        <span className="workspace-terminal__title" title={cwd}>{workspace.name} · Terminal</span>
        {(error || status?.exited) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || creating}
            onClick={terminals.length ? create : () => setAttempt((value) => value + 1)}
          >
            {error ? 'Retry' : 'New shell'}
          </Button>
        ) : (
          <span className="workspace-terminal__status" title={connectionLabel(status)}>
            {status?.connected ? '' : connectionLabel(status)}
          </span>
        )}
      </header>
      <div className="workspace-terminal__tabs">
        <TabStrip
          className="workspace-terminal__strip"
          orientation="horizontal"
          items={terminals.map((item, index) => ({
            id: item.id,
            label: `${item.name || `Terminal ${index + 1}`}${statuses[item.id]?.exited ? ' (exited)' : ''}`,
            title: item.cwd,
          }))}
          activeId={activeId}
          select={setActiveId}
        />
        <Button
          variant="ghost"
          size="sm"
          className="workspace-terminal__add"
          title="New terminal"
          aria-label="New terminal"
          disabled={loading || creating}
          onClick={create}
        >
          +
        </Button>
      </div>
      {error && <p className="workspace-terminal__message" role="alert">{error}</p>}
      <div className="workspace-terminal__body">
        {terminals.map((terminal) => (
          <TerminalPanel
            key={terminal.id}
            terminal={terminal}
            active={terminal.id === activeId}
            focused={false}
            onStatus={onStatus}
            onName={onName}
          />
        ))}
      </div>
    </section>
  )
}

export default WorkspaceTerminal
