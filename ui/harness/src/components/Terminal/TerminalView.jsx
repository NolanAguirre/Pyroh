import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  ContextMenu,
  DevScope,
  Popup,
  SelectDisplay,
  StatusBar,
  StatusBarItem,
  Terminal,
} from 'component-library'
import TabStrip from '../TabStrip/tabStrip'
import api from '../../api'
import useTerminalSocket from './useTerminalSocket'
import './Terminal.css'

const DEFAULT_SIZE = { cols: 80, rows: 24 }

const errorText = (err) => (err && err.message ? err.message : String(err))

const GroupNameInput = ({ commit, cancel }) => {
  const inputRef = useRef(null)
  const doneRef = useRef(false)
  const armedRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined
    input.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      armedRef.current = true
      if (document.activeElement !== input) input.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = async (event, action) => {
    event.preventDefault()
    event.stopPropagation()
    if (doneRef.current) return
    doneRef.current = true
    const result = action()
    const ok = result && typeof result.then === 'function' ? await result : result
    if (ok === false) {
      doneRef.current = false
      inputRef.current?.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      className="terminal-group-name__input"
      type="text"
      placeholder="Group name"
      aria-label="Group name"
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(event, () => commit(event.currentTarget.value))
        else if (event.key === 'Escape') finish(event, () => cancel())
      }}
      onBlur={(event) => {
        if (doneRef.current || !armedRef.current) return
        const value = event.currentTarget.value.trim()
        finish(event, () => (value ? commit(value) : cancel()))
      }}
    />
  )
}

const STARTUP_PLACEHOLDER = '# workspace name\n## tab name\nnpm run dev'

const StartupForm = ({ devId, popup, onSave, onError }) => {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getTerminalStartup()
      .then((body) => {
        if (!cancelled) setText(typeof body?.text === 'string' ? body.text : '')
      })
      .catch((err) => {
        if (!cancelled) onError(errorText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onError])

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onSave(text)
    setSaving(false)
    if (ok && popup && popup.close) popup.close()
  }

  return (
    <DevScope id={devId} state={{ loading, saving }}>
      <form className="new-session terminal-startup" onSubmit={submit}>
        <div className="new-session__header">
          <h2>Startup terminals</h2>
          <p className="hint">
            <code># name</code> picks a workspace, <code>## name</code> opens a tab, and the lines below it run in that tab.
          </p>
        </div>
        <textarea
          className="text-input terminal-startup__text"
          value={text}
          placeholder={STARTUP_PLACEHOLDER}
          spellCheck={false}
          autoFocus
          disabled={loading}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="terminal-startup__actions">
          <Button devId="s4t8rpv" variant="primary" size="sm" type="submit" disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </DevScope>
  )
}

const connectionLabel = (status) => {
  if (!status) return 'Connecting…'
  if (status.exited) return status.exitCode == null ? 'Exited' : `Exited (${status.exitCode})`
  return status.connected ? 'Connected' : 'Reconnecting…'
}

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

const TerminalView = ({ devId, workspaces = [], workspace, workspaceId, term = null, onTermChange, onSelectWorkspace, onBack }) => {
  const [terminals, setTerminals] = useState([])
  const [groups, setGroups] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [statuses, setStatuses] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [namingGroup, setNamingGroup] = useState(false)
  const autoCreated = useRef(new Set())
  const workspaceKey = workspaceId || ''
  const root = workspace?.cwd || ''
  const workspaceTerminals = terminals.filter((item) => (item.workspaceId || '') === workspaceKey)

  const activeId = terminals.some((item) => item.id === term) ? term : workspaceTerminals[0]?.id || null
  const activeTerminal = terminals.find((item) => item.id === activeId) || null
  const activeStatus = activeId ? statuses[activeId] : null

  const onStatus = useCallback((id, status) => {
    setStatuses((prev) => ({ ...prev, [id]: status }))
  }, [])

  const onName = useCallback((id, name) => {
    if (typeof name !== 'string' || !name) return
    setTerminals((prev) => prev.map((entry) => (entry.id === id ? { ...entry, name } : entry)))
  }, [])

  const refreshGroups = useCallback(async () => {
    const { groups: groupList } = await api.listTerminalGroups(null, { all: true })
    setGroups(Array.isArray(groupList) ? groupList : [])
  }, [])

  const create = useCallback(async (groupId) => {
    setCreating(true)
    setError(null)
    try {
      const size = activeStatus?.cols ? { cols: activeStatus.cols, rows: activeStatus.rows } : DEFAULT_SIZE
      const nextGroup = typeof groupId === 'string' ? groupId : undefined
      const { terminal } = await api.createTerminal(workspaceId, { ...size, groupId: nextGroup })
      if (!terminal?.id) throw new Error('Unexpected response creating terminal')
      setTerminals((prev) => [...prev.filter((item) => item.id !== terminal.id), terminal])
      if (nextGroup) await refreshGroups()
      onTermChange(terminal.id)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setCreating(false)
    }
  }, [workspaceId, activeStatus?.cols, activeStatus?.rows, onTermChange, refreshGroups])

  const load = useCallback(() => {
    let cancelled = false
    setError(null)
    const terminalsReq = api.listTerminals(null, { all: true })
    const groupsReq = api.listTerminalGroups(null, { all: true }).catch(() => ({ groups: [] }))
    Promise.all([terminalsReq, groupsReq])
      .then(([{ terminals: list }, { groups: groupList }]) => {
        if (cancelled) return
        setTerminals(Array.isArray(list) ? list : [])
        setGroups(Array.isArray(groupList) ? groupList : [])
        setLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        setTerminals([])
        setGroups([])
        setLoaded(false)
        setError(errorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return load()
  }, [load])

  const saveStartup = async (text) => {
    setError(null)
    try {
      await api.saveTerminalStartup(text)
      load()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    }
  }

  useEffect(() => {
    setNamingGroup(false)
  }, [workspaceKey])

  useEffect(() => {
    if (!loaded || workspaceTerminals.length > 0 || autoCreated.current.has(workspaceKey)) return
    const termElsewhere = term && terminals.some((item) => item.id === term && (item.workspaceId || '') !== workspaceKey)
    if (termElsewhere) return
    autoCreated.current.add(workspaceKey)
    create()
  }, [loaded, workspaceTerminals.length, workspaceKey, create, term, terminals])

  useEffect(() => {
    if (!loaded || creating || !activeTerminal) return
    const owner = activeTerminal.workspaceId || null
    const current = workspaceId || null
    if (owner && owner !== current) {
      onSelectWorkspace(owner, activeTerminal.id)
      return
    }
    if ((activeId || null) !== (term || null)) onTermChange(activeId)
  }, [loaded, creating, activeId, activeTerminal, term, workspaceId, onTermChange, onSelectWorkspace])

  const terminalName = (item) => item?.name || 'Terminal'

  const startRename = (id) => {
    const item = terminals.find((entry) => entry.id === id)
    if (!item) return
    setEditingId(id)
    setError(null)
  }

  const cancelRename = () => {
    setEditingId(null)
  }

  const applyTerminal = (terminal) => {
    if (!terminal?.id) return
    setTerminals((prev) => prev.map((entry) => (entry.id === terminal.id ? { ...entry, ...terminal } : entry)))
  }

  const commitRename = async (id, name) => {
    const item = terminals.find((entry) => entry.id === id)
    const next = String(name ?? '').trim()
    if (!next || next === terminalName(item)) {
      setEditingId(null)
      return true
    }
    try {
      const { terminal } = await api.renameTerminal(id, next)
      applyTerminal(terminal)
      setEditingId(null)
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    }
  }

  const setGroup = async (id, groupId) => {
    try {
      const { terminal } = await api.setTerminalGroup(id, groupId)
      applyTerminal(terminal)
      if (terminal?.groupId) await refreshGroups()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    }
  }

  const createGroup = async (name) => {
    const next = String(name ?? '').trim()
    if (!next) return false
    setCreating(true)
    setError(null)
    try {
      const { group } = await api.createTerminalGroup(workspaceId, { name: next })
      if (!group?.id) throw new Error('Unexpected response creating group')
      setGroups((prev) => [...prev.filter((entry) => entry.id !== group.id), group])
      setNamingGroup(false)
      await create(group.id)
      return true
    } catch (err) {
      setError(errorText(err))
      setCreating(false)
      return false
    }
  }

  const joinGroup = async (item, other) => {
    const groupId = other.groupId || item.groupId || crypto.randomUUID()
    if (other.groupId !== groupId) {
      const ok = await setGroup(other.id, groupId)
      if (!ok) return
    }
    if (item.groupId !== groupId) await setGroup(item.id, groupId)
  }

  const createInGroup = async (item) => {
    const groupId = item.groupId || crypto.randomUUID()
    if (!item.groupId) {
      const ok = await setGroup(item.id, groupId)
      if (!ok) return
    }
    await create(groupId)
  }

  const groupMenu = (payload) => {
    if (payload?.strip) {
      return [
        { id: 'new-group', label: 'New group…', disabled: creating || namingGroup, run: () => setNamingGroup(true) },
      ]
    }
    const item = terminals.find((entry) => entry.id === payload?.id)
    if (!item) return []
    const others = terminals.filter((entry) => {
      if (entry.id === item.id) return false
      if ((entry.workspaceId || null) !== (item.workspaceId || null)) return false
      if (item.groupId && entry.groupId === item.groupId) return false
      return true
    })
    return [
      { id: 'new-in-group', label: 'New terminal in group', run: () => createInGroup(item) },
      item.groupId ? { id: 'leave-group', label: 'Leave group', run: () => setGroup(item.id, null) } : null,
      others.length > 0 ? { separator: true } : null,
      ...others.map((other) => ({
        id: `group-${other.id}`,
        label: `Group with ${terminalName(other)}`,
        run: () => joinGroup(item, other),
      })),
    ]
  }

  const close = async (id) => {
    const status = statuses[id]
    const running = !(status?.exited || terminals.find((item) => item.id === id)?.exited)
    if (running && !window.confirm('This shell is still running. Close the tab and kill it?')) return
    try {
      await api.killTerminal(id)
    } catch (err) {
      if (err.status !== 404) {
        setError(errorText(err))
        return
      }
    }
    setTerminals((prev) => prev.filter((item) => item.id !== id))
    setStatuses((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)))
  }

  const groupKey = (owner, groupId) => `${owner || ''}:${groupId}`
  const groupById = new Map(groups.map((group) => [groupKey(group.workspaceId, group.id), group]))

  const workspaceRank = (id) => {
    if (!id) return workspaces.length + 1
    const index = workspaces.findIndex((entry) => entry.id === id)
    return index === -1 ? workspaces.length : index
  }

  const workspaceLabel = (id) => {
    if (!id) return 'Base directory'
    const match = workspaces.find((entry) => entry.id === id)
    return match?.name || 'Workspace'
  }

  const orderedTerminals = [...terminals].sort((a, b) => {
    const rank = workspaceRank(a.workspaceId) - workspaceRank(b.workspaceId)
    if (rank !== 0) return rank
    return (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id))
  })

  const selectTerminal = (id) => {
    const item = terminals.find((entry) => entry.id === id)
    if (!item) return
    const owner = item.workspaceId || null
    const current = workspaceId || null
    if (owner && owner !== current) {
      onSelectWorkspace(owner, id)
      return
    }
    onTermChange(id)
  }

  const tabItems = orderedTerminals.map((item) => {
    const name = terminalName(item)
    const editing = editingId === item.id
    const group = item.groupId ? groupById.get(groupKey(item.workspaceId, item.groupId)) : null
    return {
      id: item.id,
      label: statuses[item.id]?.exited && !editing ? `${name} (exited)` : name,
      title: item.cwd,
      sectionId: item.workspaceId || 'base',
      sectionName: workspaceLabel(item.workspaceId),
      groupId: item.groupId || null,
      groupColor: group?.color,
      groupName: group?.name,
      editing,
      editValue: name,
      onEditCommit: (value) => commitRename(item.id, value),
      onEditCancel: cancelRename,
      onDoubleClick: () => startRename(item.id),
    }
  })

  const workspaceOptions = workspaces.length
    ? workspaces.map((item) => ({ value: item.id, displayValue: item.name }))
    : [{ value: '', displayValue: 'Base directory' }]

  const switchWorkspace = (value) => {
    const next = workspaces.find((item) => item.id.toLowerCase() === value)
    if (next && next.id !== workspaceId) onSelectWorkspace(next.id)
  }

  return (
    <DevScope id={devId} state={{ workspace: workspaceId, active: activeId, tabs: terminals.length, loaded }}>
      <div className="terminal-view">
        <DevScope id="go6dx34" state={{ workspace: workspaceId }}>
          <header className="terminal-topbar">
            <Button devId="27bgrvy" variant="secondary" size="sm" onClick={onBack}>
              ← Sessions
            </Button>
            <div className="terminal-topbar__title">
              <strong>{workspace?.name || 'Base directory'}</strong>
              <span className="terminal-topbar__root" title={root}>{root}</span>
            </div>
            <DevScope id="iqf0qui" state={{ workspace: workspaceId, count: workspaces.length }}>
              <SelectDisplay
                className="terminal-topbar__workspace"
                aria-label="Workspace"
                selected={(workspaceId || '').toLowerCase()}
                options={workspaceOptions}
                select={switchWorkspace}
                disabled={workspaces.length === 0}
              />
            </DevScope>
            <Popup devId="m3k9tqs" panelClassName="new-session-panel">
              <StartupForm devId="w7b2nxe" onSave={saveStartup} onError={setError} />
              <Button devId="h5r1cjd" variant="secondary" size="sm" title="Terminals to start automatically">
                Startup
              </Button>
            </Popup>
          </header>
        </DevScope>
        <section className="terminal-main">
          <div className="terminal-tabs">
            {namingGroup && (
              <DevScope id="q2n8grp" state={{ naming: true }}>
                <div className="terminal-group-name">
                  <GroupNameInput commit={createGroup} cancel={() => setNamingGroup(false)} />
                </div>
              </DevScope>
            )}
            <ContextMenu devId="n7q4gpx" items={groupMenu}>
              <TabStrip
                devId="abtd639"
                className="terminal-tabs__strip"
                items={tabItems}
                activeId={activeId}
                select={selectTerminal}
                close={close}
              />
            </ContextMenu>
            <Button
              devId="cv4sl54"
              variant="ghost"
              size="sm"
              className="terminal-tabs__add"
              title="New terminal"
              aria-label="New terminal"
              disabled={creating}
              onClick={create}
            >
              +
            </Button>
          </div>
          <div className="terminal-main__body">
            {terminals.map((item) => (
              <TerminalPanel
                key={item.id}
                terminal={item}
                active={item.id === activeId}
                focused={item.id === activeId && editingId == null}
                onStatus={onStatus}
                onName={onName}
              />
            ))}
            {terminals.length === 0 && (error || (loaded && !creating)) && (
              <DevScope id="yvlova0" state={{ error: Boolean(error), loaded }}>
                <div className="terminal-message">
                  {error && <p className="terminal-message__error">{error}</p>}
                  {!error && <p>No terminals open in this workspace.</p>}
                  <div className="terminal-message__actions">
                    {error && !loaded && (
                      <Button devId="i12w7wb" variant="secondary" size="sm" onClick={load}>Retry</Button>
                    )}
                    {(loaded || !error) && (
                      <Button devId="tdgd40q" variant="secondary" size="sm" disabled={creating} onClick={create}>
                        New terminal
                      </Button>
                    )}
                  </div>
                </div>
              </DevScope>
            )}
          </div>
        </section>
        <StatusBar devId="4g03zfy">
          <StatusBarItem align="left" title={activeTerminal?.cwd || root}>
            <span className="terminal-status__cwd">{activeTerminal?.cwd || root}</span>
          </StatusBarItem>
          {error && terminals.length > 0 && (
            <StatusBarItem align="left" title="Dismiss" onClick={() => setError(null)}>
              <span className="terminal-status__error">⚠ {error}</span>
            </StatusBarItem>
          )}
          {activeStatus?.cols && (
            <StatusBarItem align="right">{activeStatus.cols} x {activeStatus.rows}</StatusBarItem>
          )}
          {activeTerminal && (
            <StatusBarItem align="right">
              <span className={activeStatus?.exited ? 'terminal-status__exited' : undefined}>
                {connectionLabel(activeStatus)}
              </span>
            </StatusBarItem>
          )}
        </StatusBar>
      </div>
    </DevScope>
  )
}

export default TerminalView
