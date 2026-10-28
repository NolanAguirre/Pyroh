import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Popup,
  Button,
  DevScope,
  DropdownTypeahead,
  DropdownTypeaheadTrigger,
  DropdownTypeaheadMenu,
  FormSearch,
  FormToggle,
  FolderIcon,
  ScrollingText,
} from 'component-library'
import NewSessionForm from './NewSessionForm'
import NewWorkspaceForm from './NewWorkspaceForm'
import UiSettingsForm from './UiSettingsForm'
import { formatCompactNumber, formatDuration } from '../format'

const LATEST_KEPT = 10
const ARCHIVED_PAGE = 50

const byLatest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(a.id).localeCompare(String(b.id))

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  error: 'danger',
}

const ICONS = {
  editor: 'M4 5.5 1.5 8 4 10.5M12 5.5 14.5 8 12 10.5M9.2 3.5 6.8 12.5',
  settings: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.6v1.5M8 12.9v1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M1.6 8h1.5M12.9 8h1.5M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  terminal: 'M2.5 4.5 6 8l-3.5 3.5M8 12h5.5',
  git: 'M5 5v6M11 6c0 2.5-6 1.5-6 4.5M6.5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM12.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  codeStats: 'M2 3.5h12M2 6.5h8M2 9.5h10M2 12.5h5',
  analytics: 'M2 13.5V9M6 13.5V5M10 13.5V7.5M14 13.5V3M1.5 13.5h13',
  registry: 'M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z',
  workspace: 'M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM8 6.5v5M5.5 9h5',
  session: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v6M5 8h6',
  archive: 'M1.5 2.5h13v2.5h-13zM2.5 5v8.5h11V5M6 8.5h4',
}

// Header buttons come from registry panels; these are their DevScope ids.
const PANEL_DEV_IDS = {
  editor: 'f2a6rat',
  terminal: 'gh4tt4y',
  git: '7vr4nuz',
  'code-stats': 'c7q2x9a',
  analytics: 'vqx75km',
  registry: 'r3g8x2k',
}

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const SessionRow = memo(({ session, active, onSelect, onRename, onArchive, archiveBusy, onPin, pinBusy }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const skipCommit = useRef(false)

  const startEdit = (event) => {
    event.stopPropagation()
    skipCommit.current = false
    setDraft(session.name || '')
    setError('')
    setEditing(true)
  }

  const cancelEdit = (event) => {
    event.preventDefault()
    skipCommit.current = true
    setDraft(session.name || '')
    setError('')
    setEditing(false)
  }

  const commit = async () => {
    if (skipCommit.current) {
      skipCommit.current = false
      return
    }
    const next = draft.trim()
    if (next === (session.name || '')) {
      setEditing(false)
      setError('')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onRename(session.id, next)
      setEditing(false)
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleArchiveClick = (event) => {
    event.stopPropagation()
    onArchive(session.id, !session.archived)
  }

  const handlePinClick = (event) => {
    event.stopPropagation()
    onPin(session.id, !session.pinned)
  }

  const isLive = session.status === 'running' || session.status === 'awaiting_input'
  const tokenTotal = session.totals?.tokens?.total ?? 0
  const durationMs = session.totals?.durationMs || 0

  return (
    <DevScope id="hr1a5e8" state={{ session: session.id, active, editing, named: Boolean(session.name), pinned: Boolean(session.pinned) }}>
      <div
        className={`session-row${active ? ' session-row--active' : ''}${session.archived ? ' session-row--archived' : ''}${session.pinned ? ' session-row--pinned' : ''}`}
        onClick={() => onSelect(session.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(session.id)
        }}
      >
        <div className="session-row__top">
          {editing ? (
            <DevScope id="f3k8m2q" state={{ busy, error: Boolean(error) }}>
              <form
                className="session-row__name-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  commit()
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  className="text-input session-row__name-input"
                  value={draft}
                  aria-label="Session name"
                  placeholder="Session name"
                  autoFocus
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelEdit(event)
                  }}
                  onBlur={commit}
                />
              </form>
            </DevScope>
          ) : (
            <div className="session-row__title-wrap">
              <DevScope id="q2n6w8r" state={{ pinned: Boolean(session.pinned) }}>
                <button
                  type="button"
                  className={`session-row__edit-btn session-row__pin-btn${session.pinned ? ' session-row__pin-btn--on' : ''}`}
                  title={session.pinned ? 'Unpin session' : 'Pin session'}
                  aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
                  aria-pressed={Boolean(session.pinned)}
                  disabled={pinBusy}
                  onClick={handlePinClick}
                >
                  <svg viewBox="0 0 24 24" fill={session.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </svg>
                </button>
              </DevScope>
              <DevScope id="w2s9f4j" state={{ named: Boolean(session.name) }}>
                <ScrollingText
                  animate="hover"
                  className={`session-row__name${session.name ? '' : ' session-row__name--empty'}`}
                  title={session.name || session.id}
                >
                  {session.name || 'Untitled session'}
                </ScrollingText>
              </DevScope>
              <DevScope id="i5a8p1o">
                <button
                  type="button"
                  className="session-row__edit-btn"
                  title="Rename session"
                  aria-label="Rename session"
                  onClick={startEdit}
                >
                  ✎
                </button>
              </DevScope>
              <DevScope id="p5t1m7k">
                <button
                  type="button"
                  className="session-row__edit-btn session-row__trash-btn"
                  title={session.archived ? 'Restore session' : 'Archive session'}
                  aria-label={session.archived ? 'Restore session' : 'Archive session'}
                  disabled={archiveBusy}
                  onClick={handleArchiveClick}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                </button>
              </DevScope>
            </div>
          )}
          <DevScope id="l9d2h6e" state={{ status: session.status, live: isLive }}>
            <div className="session-row__top-right">
              {isLive && <span className="session-row__pulse" aria-hidden="true" />}
              <Badge size="small" variant={STATUS_VARIANT[session.status] || 'neutral'}>
                {session.status}
              </Badge>
            </div>
          </DevScope>
        </div>

        <DevScope id="z4n0t7u" state={{ provider: session.provider, model: session.model || '' }}>
          <div className="session-row__info">
            <span className="session-row__identity">
              <span className="session-row__provider">
                {session.provider}
                {session.model ? ` · ${session.model}` : ''}
              </span>
              {session.id && (
                <span className="session-row__id" title={session.id}>{session.id}</span>
              )}
            </span>
            <div className="session-row__meta">
              <span>{formatCompactNumber(tokenTotal)} tok</span>
              <span>{formatDuration(durationMs)}</span>
            </div>
          </div>
        </DevScope>

        {error && (
          <DevScope id="b6y1c9a">
            <p className="hint hint--error" role="alert">{error}</p>
          </DevScope>
        )}
      </div>
    </DevScope>
  )
})

const SessionsSidebar = ({
  devId,
  workspaces = [],
  workspace,
  providers,
  sessions = [],
  activeId,
  onSelectWorkspace,
  onSelect,
  onRename,
  onWorkspaceCreated,
  onDeleteWorkspace,
  onCreated,
  panels = [],
  view,
  onOpenPanel,
  showArchived,
  onShowArchived,
  onArchive,
  onArchiveOlder,
  archiveBusy,
  archiveError,
  onPin,
  pinBusy,
  pinError,
  transcriptFontSize = 13,
  onTranscriptFontSize,
  settingsError = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [archivedLimit, setArchivedLimit] = useState(ARCHIVED_PAGE)

  useEffect(() => {
    setArchivedLimit(ARCHIVED_PAGE)
  }, [showArchived, searchQuery, workspace?.id])

  // Rows are memoized, so they get stable handlers that call the latest props.
  const handlers = useRef(null)
  handlers.current = { onSelect, onRename, onArchive, onPin }
  const rowHandlers = useMemo(() => ({
    onSelect: (...args) => handlers.current.onSelect(...args),
    onRename: (...args) => handlers.current.onRename(...args),
    onArchive: (...args) => handlers.current.onArchive(...args),
    onPin: (...args) => handlers.current.onPin(...args),
  }), [])

  const deleteWorkspace = async () => {
    if (!workspace || deleteBusy || !onDeleteWorkspace) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await onDeleteWorkspace(workspace.id)
    } catch (err) {
      setDeleteError(err && err.message ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  const workspaceOptions = workspaces.map((item) => ({
    value: item.id,
    displayValue: item.name,
  }))

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const matched = query
      ? sessions.filter((s) => {
        const name = (s.name || '').toLowerCase()
        const provider = (s.provider || '').toLowerCase()
        const model = (s.model || '').toLowerCase()
        const id = (s.id || '').toLowerCase()
        return name.includes(query) || provider.includes(query) || model.includes(query) || id.includes(query)
      })
      : sessions
    return [...matched].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }, [sessions, searchQuery])

  const { mainSessions, archivedSessions } = useMemo(() => ({
    mainSessions: filteredSessions.filter(s => s.pinned || !s.archived),
    archivedSessions: filteredSessions.filter(s => !s.pinned && s.archived),
  }), [filteredSessions])
  const shownSessions = [...mainSessions, ...archivedSessions.slice(0, archivedLimit)]
  const hiddenArchived = Math.max(0, archivedSessions.length - archivedLimit)

  const sessionsToArchive = useMemo(() => {
    const unpinned = sessions
      .filter(session => !session.pinned && !session.archived)
      .sort(byLatest)
    return unpinned.slice(LATEST_KEPT)
  }, [sessions])

  const archiveOlder = () => {
    if (archiveBusy || !sessionsToArchive.length || !onArchiveOlder) return
    onArchiveOlder(sessionsToArchive.map(session => session.id))
  }

  const archiveOlderTitle = sessionsToArchive.length
    ? `Archive ${sessionsToArchive.length} older session${sessionsToArchive.length === 1 ? '' : 's'}, keeping the ${LATEST_KEPT} latest. Pinned sessions stay.`
    : `The ${LATEST_KEPT} latest sessions are already kept. Pinned sessions stay.`

  return (
    <DevScope id={devId} state={{ workspace: workspace?.id, session: activeId, search: Boolean(searchQuery) }}>
      <aside className="sidebar">
        <DevScope id="t8w3n6p">
          <div className="sidebar__header">
            <div className="sidebar__header-actions">
              <Popup devId="n7p3v6c" panelClassName="ui-settings-panel">
                <UiSettingsForm
                  devId="b2x9t5h"
                  transcriptFontSize={transcriptFontSize}
                  onTranscriptFontSize={onTranscriptFontSize}
                  error={settingsError}
                />
                <Button variant="secondary" size="sm" devId="k4m8q2w" title="Settings" aria-label="Settings">
                  <Icon d={ICONS.settings} />
                </Button>
              </Popup>
              {panels.map((panel) => {
                // `main` panels toggle inside the layout; `page` panels replace it.
                const toggle = panel.placement === 'main'
                const open = view === panel.id
                return (
                  <Button
                    key={panel.id}
                    variant={toggle && open ? 'primary' : 'secondary'}
                    size="sm"
                    devId={PANEL_DEV_IDS[panel.id]}
                    title={panel.title || panel.label}
                    aria-label={panel.label}
                    aria-pressed={toggle ? open : undefined}
                    onClick={() => onOpenPanel?.(panel.id)}
                    disabled={panel.needsWorkspace && !workspace}
                  >
                    {ICONS[panel.icon] ? <Icon d={ICONS[panel.icon]} /> : panel.label.slice(0, 2)}
                  </Button>
                )
              })}
              <Popup devId="hr8v4j2" panelClassName="new-session-panel">
                <NewWorkspaceForm devId="hr0k6t2" onCreated={onWorkspaceCreated} />
                <Button variant="secondary" size="sm" devId="hr2p9x5" title="Create a new workspace" aria-label="New workspace">
                  <Icon d={ICONS.workspace} />
                </Button>
              </Popup>
              <Popup devId="hr6d3q8" panelClassName="new-session-panel">
                <NewSessionForm
                  devId="hr4q8c0"
                  providers={providers}
                  workspace={workspace}
                  onCreated={onCreated}
                />
                <Button variant="primary" size="sm" disabled={!workspace} devId="hr4b7s1" title="Start a new session" aria-label="New session">
                  <Icon d={ICONS.session} />
                </Button>
              </Popup>
            </div>
          </div>
        </DevScope>

        <div className="sidebar__workspace">
          {workspaces.length === 0 ? (
            <DevScope id="r5t1y9b">
              <p className="hint">Create a workspace to choose a working directory.</p>
            </DevScope>
          ) : (
            <>
              <DevScope id="hr9f0l3">
                <div className="sidebar__workspace-selector">
                  <DropdownTypeahead
                    key={workspace?.id || 'none'}
                    defaultValue={workspace?.id || ''}
                    options={workspaceOptions}
                    change={onSelectWorkspace}
                    filter
                  >
                    <DropdownTypeaheadTrigger placeholder="Select a workspace…" />
                    <DropdownTypeaheadMenu filterPlaceholder="Find a workspace…" />
                  </DropdownTypeahead>
                </div>
              </DevScope>
              {workspace && (
                <DevScope id="j6v0e3d" state={{ workspace: workspace.id, deleteBusy }}>
                  <div className="sidebar__cwd" title={workspace.cwd}>
                    <FolderIcon size={12} className="sidebar__cwd-icon" />
                    <span className="sidebar__cwd-text">{workspace.cwd}</span>
                    <button
                      type="button"
                      className="sidebar__cwd-delete"
                      title="Remove workspace"
                      aria-label="Remove workspace"
                      disabled={deleteBusy}
                      onClick={deleteWorkspace}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    </button>
                  </div>
                  {deleteError && (
                    <p className="hint hint--error" role="alert">{deleteError}</p>
                  )}
                </DevScope>
              )}
            </>
          )}
        </div>

        <div className="sidebar__controls">
          <DevScope id="a9f4k8s" state={{ search: Boolean(searchQuery) }}>
            <div className="sidebar__search-row">
              <FormSearch
                field={{ value: searchQuery, onChange: (e) => setSearchQuery(e.target.value) }}
                placeholder="Search sessions…"
              />
            </div>
          </DevScope>
          <DevScope id="u1n7z2x" state={{ archived: Boolean(showArchived), count: sessions.length, older: sessionsToArchive.length }}>
            <div className="sidebar__filter-bar">
              <label className="sidebar__toggle-label">
                <FormToggle
                  field={{ value: showArchived, onChange: (e) => onShowArchived(e.target.checked) }}
                />
                <span className="sidebar__toggle-text">Show archived</span>
              </label>
              <div className="sidebar__filter-actions">
                <DevScope id="q8n4k2w" state={{ older: sessionsToArchive.length, busy: Boolean(archiveBusy) }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    title={archiveOlderTitle}
                    aria-label="Archive older sessions"
                    disabled={archiveBusy || sessionsToArchive.length === 0}
                    onClick={archiveOlder}
                  >
                    <Icon d={ICONS.archive} />
                  </Button>
                </DevScope>
                <Badge size="small" variant="neutral" count={sessions.length} showZero />
              </div>
            </div>
          </DevScope>
        </div>

        {archiveError && (
          <DevScope id="c3p6w5m">
            <p className="hint hint--error sidebar__error" role="alert">{archiveError}</p>
          </DevScope>
        )}

        {pinError && (
          <DevScope id="d8k4t2y">
            <p className="hint hint--error sidebar__error" role="alert">{pinError}</p>
          </DevScope>
        )}

        <DevScope id="h8l2q9r" state={{ count: filteredSessions.length }}>
          <div className="sidebar__list">
            {!workspace && workspaces.length > 0 && (
              <DevScope id="e4b7d1t">
                <p className="hint sidebar__empty-hint">Select a workspace above to view sessions.</p>
              </DevScope>
            )}
            {workspace && sessions.length === 0 && (
              <DevScope id="g0x5m8v">
                <div className="sidebar__empty-state">
                  <p className="hint">No sessions in this workspace yet.</p>
                  <Popup devId="r7k1b9w" panelClassName="new-session-panel">
                    <NewSessionForm
                      devId="t4m8v2p"
                      providers={providers}
                      workspace={workspace}
                      onCreated={onCreated}
                    />
                    <Button variant="secondary" size="sm" devId="k9x3e7b">
                      + Create Session
                    </Button>
                  </Popup>
                </div>
              </DevScope>
            )}
            {workspace && sessions.length > 0 && filteredSessions.length === 0 && (
              <DevScope id="y7k3c6n" state={{ search: Boolean(searchQuery) }}>
                <p className="hint sidebar__empty-hint">No sessions match &ldquo;{searchQuery}&rdquo;</p>
              </DevScope>
            )}
            {shownSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={rowHandlers.onSelect}
                onRename={rowHandlers.onRename}
                onArchive={rowHandlers.onArchive}
                archiveBusy={archiveBusy}
                onPin={rowHandlers.onPin}
                pinBusy={pinBusy}
              />
            ))}
            {hiddenArchived > 0 && (
              <DevScope id="m4r8s2v" state={{ hidden: hiddenArchived }}>
                <div className="sidebar__show-more">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setArchivedLimit(limit => limit + ARCHIVED_PAGE)}
                  >
                    Show more ({hiddenArchived} archived)
                  </Button>
                </div>
              </DevScope>
            )}
          </div>
        </DevScope>
      </aside>
    </DevScope>
  )
}

export default SessionsSidebar
