import { useMemo, useRef } from 'react'
import {
  Badge,
  Popup,
  Button,
  DevScope,
  FormSearch,
  FormToggle,
} from 'component-library'
import NewSessionForm from './NewSessionForm'
import SessionRow from './Sidebar/SessionRow'
import SidebarHeader from './Sidebar/SidebarHeader'
import WorkspaceSection from './Sidebar/WorkspaceSection'
import useSidebarSessions, { LATEST_KEPT } from './Sidebar/useSidebarSessions'
import { ICONS, Icon } from './Sidebar/icons'

const SessionsSidebar = ({
  devId,
  workspaces = [],
  workspace,
  providers,
  sessions = [],
  searchQuery = '',
  onSearchQueryChange,
  activeId,
  onSelectWorkspace,
  onSelect,
  onRename,
  onWorkspaceCreated,
  onWorkspaceUpdated,
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
  const { filteredSessions, shownSessions, hiddenArchived, sessionsToArchive, showMoreArchived } = useSidebarSessions({
    sessions,
    searchQuery,
    showArchived,
    workspaceId: workspace?.id,
  })

  // Rows are memoized, so they get stable handlers that call the latest props.
  const handlers = useRef(null)
  handlers.current = { onSelect, onRename, onArchive, onPin }
  const rowHandlers = useMemo(() => ({
    onSelect: (...args) => handlers.current.onSelect(...args),
    onRename: (...args) => handlers.current.onRename(...args),
    onArchive: (...args) => handlers.current.onArchive(...args),
    onPin: (...args) => handlers.current.onPin(...args),
  }), [])

  const groupedSessions = useMemo(() => {
    const ids = new Set(shownSessions.map(session => session.id))
    const children = new Map()
    for (const session of shownSessions) {
      if (!session.parentSessionId || !ids.has(session.parentSessionId)) continue
      if (!children.has(session.parentSessionId)) children.set(session.parentSessionId, [])
      children.get(session.parentSessionId).push(session)
    }
    const visited = new Set()
    const branch = (session) => {
      if (visited.has(session.id)) return null
      visited.add(session.id)
      return { session, children: (children.get(session.id) || []).map(branch).filter(Boolean) }
    }
    const roots = shownSessions.filter(session => !session.parentSessionId || !ids.has(session.parentSessionId))
      .map(branch)
    // Keep rows visible even if a malformed parent chain contains a cycle.
    return [...roots, ...shownSessions.filter(session => !visited.has(session.id)).map(branch).filter(Boolean)]
  }, [shownSessions])

  const renderSession = ({ session, children }) => (
    <div
      key={session.id}
      className={session.parentSessionId
        ? `sidebar__child-session${session.childKind === 'fork' ? ' sidebar__child-session--fork' : ''}`
        : undefined}
    >
      <SessionRow
        session={session}
        active={session.id === activeId}
        onSelect={rowHandlers.onSelect}
        onRename={rowHandlers.onRename}
        onArchive={rowHandlers.onArchive}
        archiveBusy={archiveBusy}
        onPin={rowHandlers.onPin}
        pinBusy={pinBusy}
      />
      {children.map(renderSession)}
    </div>
  )

  const archiveOlder = () => {
    if (archiveBusy || !sessionsToArchive.length || !onArchiveOlder) return
    onArchiveOlder(sessionsToArchive.map(session => session.id))
  }

  const archiveOlderTitle = sessionsToArchive.length
    ? `Archive ${sessionsToArchive.length} session${sessionsToArchive.length === 1 ? '' : 's'} from older runs. Any run with a session in the ${LATEST_KEPT} latest is kept whole. Pinned sessions stay.`
    : `No older runs to archive. Any run with a session in the ${LATEST_KEPT} latest is kept whole. Pinned sessions stay.`

  return (
    <DevScope id={devId} state={{ workspace: workspace?.id, session: activeId, search: Boolean(searchQuery) }}>
      <aside className="sidebar">
        <SidebarHeader
          workspace={workspace}
          providers={providers}
          panels={panels}
          view={view}
          onOpenPanel={onOpenPanel}
          onWorkspaceCreated={onWorkspaceCreated}
          onCreated={onCreated}
          transcriptFontSize={transcriptFontSize}
          onTranscriptFontSize={onTranscriptFontSize}
          settingsError={settingsError}
        />

        <WorkspaceSection
          workspaces={workspaces}
          workspace={workspace}
          onSelectWorkspace={onSelectWorkspace}
          onWorkspaceUpdated={onWorkspaceUpdated}
          onDeleteWorkspace={onDeleteWorkspace}
        />

        <div className="sidebar__controls">
          <DevScope id="a9f4k8s" state={{ search: Boolean(searchQuery) }}>
            <div className="sidebar__search-row">
              <FormSearch
                field={{ value: searchQuery, onChange: (e) => onSearchQueryChange(e.target.value) }}
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
            {groupedSessions.map(renderSession)}
            {hiddenArchived > 0 && (
              <DevScope id="m4r8s2v" state={{ hidden: hiddenArchived }}>
                <div className="sidebar__show-more">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={showMoreArchived}
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
