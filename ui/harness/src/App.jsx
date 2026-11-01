import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  CardRow,
  CardLabel,
  DevInspector,
  DevScope,
  FolderIcon,
  Popup,
  SplitPane,
  Tab,
  TabList,
  TabsDisplay,
  useBrowserLocation,
  useMediaQuery,
} from 'component-library'
import SessionsSidebar from './components/SessionsSidebar'
import SessionView from './components/SessionView'
import RunningJobsNav from './components/RunningJobsNav'
import EditorView from './components/Editor/EditorView'
import TerminalView from './components/Terminal/TerminalView'
import GitView from './components/Git/GitView'
import AnalyticsView from './components/Analytics/AnalyticsView'
import CodeStatsView from './components/CodeStats/CodeStatsView'
import RegistryView from './components/Registry/RegistryView'
import MemoriesView from './components/Memories/MemoriesView'
import NewSessionForm from './components/NewSessionForm'
import NewWorkspaceForm from './components/NewWorkspaceForm'
import api from './api'
import harnessForms from './components/HarnessInspector/harnessForms'
import SessionExplorer from './components/HarnessInspector/sessionExplorer'
import './App.css'

const harnessViews = [{
  id: 'harness-sessions',
  title: 'Harness sessions',
  icon: '☷',
  component: SessionExplorer,
}]

const WORKSPACE_KEY = 'harness.activeWorkspaceId'
const WORKSPACE_PARAM = 'workspace'
const SESSION_PARAM = 'session'
const VIEW_PARAM = 'view'
const FILE_PARAM = 'file'
const TERM_PARAM = 'term'
// Panels come from the registry; `?view=` holds the open panel id.
const EDITOR_PANEL = 'editor'
// Extra URL changes when a panel opens or closes.
const PANEL_OPEN_PARAMS = { git: { file: null } }
const PANEL_CLOSE_PARAMS = { terminal: { term: null }, git: { file: null } }
const MODE_ICONS = { agent: '▶', ask: '?', plan: '◇', decompose: '⑂', 'token-waste': '⚙', 'memory-extract': '✎', 'new-chat': '↪' }
const ACTIVE_JOB = (session) => session.status === 'running' || session.status === 'awaiting_input'
const JOB_LIST_LIMIT = 20
const sameSessionRow = (a, b) => a.updatedAt === b.updatedAt
  && a.status === b.status
  && a.name === b.name
  && Boolean(a.pinned) === Boolean(b.pinned)
  && Boolean(a.archived) === Boolean(b.archived)
const MOBILE_QUERY = '(max-width: 768px)'
const MOBILE_SESSIONS = 0
const MOBILE_CHAT = 1
const MOBILE_JOBS = 2

const selectionFromUrl = (url) => ({
  workspaceId: url.searchParams.get(WORKSPACE_PARAM),
  sessionId: url.searchParams.get(SESSION_PARAM),
  view: url.searchParams.get(VIEW_PARAM),
  file: url.searchParams.get(FILE_PARAM),
  term: url.searchParams.get(TERM_PARAM),
})

const urlWithSelection = (url, workspaceId, sessionId, view, file, term) => {
  const next = new URL(url.href)
  if (workspaceId) next.searchParams.set(WORKSPACE_PARAM, workspaceId)
  else next.searchParams.delete(WORKSPACE_PARAM)
  if (sessionId) next.searchParams.set(SESSION_PARAM, sessionId)
  else next.searchParams.delete(SESSION_PARAM)
  if (view) next.searchParams.set(VIEW_PARAM, view)
  else if (view === null) next.searchParams.delete(VIEW_PARAM)
  if (file) next.searchParams.set(FILE_PARAM, file)
  else if (file === null || file === '') next.searchParams.delete(FILE_PARAM)
  if (term) next.searchParams.set(TERM_PARAM, term)
  else if (term === null || term === '') next.searchParams.delete(TERM_PARAM)
  return next
}

const readStoredWorkspace = () => {
  try {
    return localStorage.getItem(WORKSPACE_KEY) || null
  } catch {
    return null
  }
}

if (!new URL(window.location.href).searchParams.get(WORKSPACE_PARAM)) {
  const stored = readStoredWorkspace()
  if (stored) {
    const next = urlWithSelection(new URL(window.location.href), stored, new URL(window.location.href).searchParams.get(SESSION_PARAM))
    window.history.replaceState(null, '', next.href)
  }
}

const AppPlaceholder = ({ workspace, workspaces = [], sessions = [], providers = [], modes = [], onCreated, onWorkspaceCreated, onOpenEditor }) => (
  <DevScope id="hr3n8w4" state={{ workspace: workspace?.id, sessionCount: sessions.length }}>
    <div className="app__placeholder-hero">
      <div className="app__placeholder-content">
        <div className="app__hero-badge">
          <Badge variant="primary" size="small">Cursor SDK Harness</Badge>
        </div>
        <h1 className="app__hero-title">Multi-Agent Development Environment</h1>
        <p className="app__hero-desc">
          {modes.length ? `Run interactive turns with ${modes.map((mode) => mode.label).join(', ')} modes.` : 'Run interactive agent turns.'}
        </p>

        {workspace ? (
          <Card>
            <CardHeader>
              <div className="app__ws-card-header">
                <span className="app__ws-card-title">Active Workspace: {workspace.name}</span>
                <Badge variant="info" size="small">{sessions.length} sessions</Badge>
              </div>
            </CardHeader>
            <CardSection>
              <div className="app__ws-cwd">
                <FolderIcon size={14} className="app__ws-cwd-icon" />
                <code>{workspace.cwd}</code>
              </div>
            </CardSection>
            <CardRow>
              <CardSection>
                <CardLabel>Quick Actions</CardLabel>
                <div className="app__hero-actions">
                  <Popup devId="y3m7p9d" panelClassName="new-session-panel">
                    <NewSessionForm
                      devId="e2b8v4k"
                      providers={providers}
                      workspace={workspace}
                      onCreated={onCreated}
                    />
                    <Button variant="primary" size="sm" devId="d6t1j9x">
                      + Start Session
                    </Button>
                  </Popup>
                  {onOpenEditor && (
                    <Button variant="secondary" size="sm" onClick={onOpenEditor} devId="n8k3w7f">
                      Open File Editor
                    </Button>
                  )}
                </div>
              </CardSection>
            </CardRow>
          </Card>
        ) : (
          <Card>
            <CardHeader>Get Started</CardHeader>
            <CardSection>
              <p className="hint">No workspace selected. Create a workspace to point at your working directory.</p>
              <div className="app__hero-actions">
                <Popup devId="a4r9b2m" panelClassName="new-session-panel">
                  <NewWorkspaceForm devId="u7m1v5c" onCreated={onWorkspaceCreated} />
                  <Button variant="primary" size="sm">
                    + Create Workspace
                  </Button>
                </Popup>
              </div>
            </CardSection>
          </Card>
        )}

        <div className="app__capabilities-grid">
          {modes.map((mode) => (
            <div key={mode.id} className="app__cap-tile">
              <span className="app__cap-icon">{MODE_ICONS[mode.id] || '◇'}</span>
              <strong>{mode.label}</strong>
              <p className="hint">{mode.hint}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </DevScope>
)

const App = () => {
  const { url, navigate } = useBrowserLocation()
  const { workspaceId: activeWorkspaceId, sessionId: activeId, view, file, term } = selectionFromUrl(url)
  const mobile = useMediaQuery(MOBILE_QUERY)
  const [mobilePane, setMobilePane] = useState(() => (activeId ? MOBILE_CHAT : MOBILE_SESSIONS))
  const showChat = () => setMobilePane(MOBILE_CHAT)
  const [providers, setProviders] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)
  const [sessions, setSessions] = useState([])
  const [sessionsReadyFor, setSessionsReadyFor] = useState(null)
  const [sessionsHaveArchived, setSessionsHaveArchived] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState(null)
  const [runningJobs, setRunningJobs] = useState([])
  const [jobsCollapsed, setJobsCollapsed] = useState(false)
  const [transcriptFontSize, setTranscriptFontSize] = useState(13)
  const [settingsError, setSettingsError] = useState('')
  const [registry, setRegistry] = useState({ modes: [], panels: [] })
  const transcriptFontTouched = useRef(false)
  const fontSaveTimer = useRef(null)
  const sessionsRequest = useRef(0)

  const go = useCallback((workspaceId, sessionId, { replace = false, view: nextView, file: nextFile, term: nextTerm } = {}) => {
    const workspaceChanged = workspaceId !== activeWorkspaceId
    const fileParam = nextFile === undefined && workspaceChanged ? null : nextFile
    const termParam = nextTerm === undefined && workspaceChanged ? null : nextTerm
    navigate(urlWithSelection(new URL(window.location.href), workspaceId, sessionId, nextView, fileParam, termParam).href, { replace })
  }, [navigate, activeWorkspaceId])

  const onFileChange = useCallback((nextFile) => {
    go(activeWorkspaceId, activeId, { replace: true, file: nextFile || null })
  }, [go, activeWorkspaceId, activeId])

  const onTermChange = useCallback((nextTerm) => {
    go(activeWorkspaceId, activeId, { replace: true, term: nextTerm || null })
  }, [go, activeWorkspaceId, activeId])

  const onTerminalWorkspace = useCallback((id, nextTerm) => {
    go(id, null, nextTerm === undefined ? {} : { replace: true, term: nextTerm })
  }, [go])

  const loadWorkspaces = useCallback(() => {
    api
      .listWorkspaces()
      .then(({ workspaces: list }) => {
        setWorkspaces(list.filter((item) => !item.deleted))
        setWorkspacesLoaded(true)
      })
      .catch(() => {
        setWorkspaces([])
        setWorkspacesLoaded(true)
      })
  }, [])

  const loadSessions = useCallback(() => {
    if (!activeWorkspaceId) {
      setSessions([])
      setSessionsReadyFor(null)
      return
    }
    const workspaceId = activeWorkspaceId
    const request = ++sessionsRequest.current
    api
      .listSessions(workspaceId, showArchived)
      .then(({ sessions: list }) => {
        if (request !== sessionsRequest.current) return
        setSessions(prev => {
          const byId = new Map(prev.map(item => [item.id, item]))
          return list.map(item => {
            const old = byId.get(item.id)
            return old && sameSessionRow(old, item) ? old : item
          })
        })
        setSessionsHaveArchived(showArchived)
        setSessionsReadyFor(workspaceId)
      })
      .catch(() => {
        if (request !== sessionsRequest.current) return
        setSessions([])
        setSessionsReadyFor(null)
      })
  }, [activeWorkspaceId, showArchived])

  const loadRunningJobs = useCallback(() => {
    api
      .listSessions(null, false, { orderBy: 'createdAt', order: 'desc', active: true, limit: JOB_LIST_LIMIT })
      .then(async ({ sessions: activeJobs }) => {
        if (activeJobs.length >= JOB_LIST_LIMIT) {
          setRunningJobs(activeJobs)
          return
        }
        const { sessions: recentChats } = await api.listSessions(null, false, {
          orderBy: 'createdAt', order: 'desc', active: false, limit: JOB_LIST_LIMIT - activeJobs.length,
        })
        const activeIds = new Set(activeJobs.map(job => job.id))
        const byRecent = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id)
        setRunningJobs([...activeJobs, ...recentChats.filter(job => !activeIds.has(job.id))].sort(byRecent))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api
      .getProviders()
      .then(({ providers: list }) => setProviders(list))
      .catch(() => setProviders([]))
    loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    let cancelled = false
    api
      .getUiSettings()
      .then(({ settings }) => {
        if (cancelled || transcriptFontTouched.current) return
        if (settings && Number.isInteger(settings.transcriptFontSize)) {
          setTranscriptFontSize(settings.transcriptFontSize)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current)
    }
  }, [])

  const changeTranscriptFontSize = (value) => {
    const next = Number(value)
    if (!Number.isInteger(next)) return
    transcriptFontTouched.current = true
    setTranscriptFontSize(next)
    setSettingsError('')
    if (fontSaveTimer.current) clearTimeout(fontSaveTimer.current)
    fontSaveTimer.current = setTimeout(() => {
      api
        .setUiSettings({ transcriptFontSize: next })
        .catch((err) => setSettingsError(err && err.message ? err.message : String(err)))
    }, 300)
  }

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // Modes and panels allowed for the active workspace.
  useEffect(() => {
    let cancelled = false
    api
      .getRegistry(activeWorkspaceId)
      .then((data) => {
        if (cancelled) return
        setRegistry({
          modes: Array.isArray(data.modes) ? data.modes : [],
          panels: Array.isArray(data.panels) ? data.panels : [],
        })
      })
      .catch(() => { if (!cancelled) setRegistry({ modes: [], panels: [] }) })
    return () => { cancelled = true }
  }, [activeWorkspaceId])

  useEffect(() => {
    loadRunningJobs()
  }, [loadRunningJobs])

  useEffect(() => {
    if (!workspacesLoaded) return
    try {
      if (activeWorkspaceId) localStorage.setItem(WORKSPACE_KEY, activeWorkspaceId)
      else localStorage.removeItem(WORKSPACE_KEY)
    } catch {
      // ignore
    }
  }, [workspacesLoaded, activeWorkspaceId])

  useEffect(() => {
    if (!workspacesLoaded) return
    if (activeWorkspaceId && workspaces.some((item) => item.id === activeWorkspaceId)) return
    const next = workspaces[0]?.id || null
    if (next === activeWorkspaceId) return
    go(next, null, { replace: true })
  }, [workspacesLoaded, workspaces, activeWorkspaceId, go])

  useEffect(() => {
    if (!activeId || sessionsReadyFor !== activeWorkspaceId) return
    if (sessions.some((item) => item.id === activeId)) return
    // The list skips archived rows while the toggle is off; look there before leaving.
    if (!sessionsHaveArchived) {
      setShowArchived(true)
      return
    }
    go(activeWorkspaceId, null, { replace: true })
  }, [activeId, activeWorkspaceId, sessions, sessionsReadyFor, sessionsHaveArchived, go])

  useEffect(() => {
    const timer = setInterval(() => {
      loadSessions()
      loadRunningJobs()
    }, 3000)
    return () => clearInterval(timer)
  }, [loadSessions, loadRunningJobs])

  const deleteWorkspace = async (id) => {
    await api.setWorkspaceDeleted(id, true)
    setWorkspaces((prev) => prev.filter((item) => item.id !== id))
  }

  const onWorkspaceCreated = (workspace) => {
    setWorkspaces((prev) =>
      [...prev.filter((item) => item.id !== workspace.id), workspace].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    )
    go(workspace.id, null)
  }

  const onWorkspaceUpdated = (workspace) => {
    setWorkspaces((prev) =>
      [...prev.filter((item) => item.id !== workspace.id), workspace].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    )
  }

  const onCreated = (session) => {
    setSessions((prev) => [session, ...prev.filter((item) => item.id !== session.id)])
    setSessionsReadyFor(activeWorkspaceId)
    go(session.workspaceId || activeWorkspaceId, session.id, { view: null })
    showChat()
  }

  const renameSession = async (id, name) => {
    const { session } = await api.setSessionName(id, name)
    setSessions(current => current.map(item => item.id === id ? { ...item, ...session } : item))
    return session
  }

  const onSelectWorkspace = (id) => {
    go(id, null)
  }

  const onSelectJob = (job) => {
    go(job.workspaceId || activeWorkspaceId, job.id, { view: null })
    showChat()
  }

  const archiveSession = async (id, archived) => {
    if (archiveBusy) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const { session } = await api.setSessionArchived(id, archived)
      setSessions(current => current.map(item => item.id === id ? session : item))
      if (archived && !showArchived && activeId === id) go(activeWorkspaceId, null, { replace: true })
    } catch (error) { setArchiveError(error.message) }
    finally { setArchiveBusy(false) }
  }

  const archiveOlderSessions = async (ids) => {
    if (archiveBusy || !ids.length) return
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const results = await Promise.allSettled(ids.map(id => api.setSessionArchived(id, true)))
      const archived = results.flatMap(result => result.status === 'fulfilled' ? [result.value.session] : [])
      const failure = results.find(result => result.status === 'rejected')
      if (archived.length) {
        const byId = new Map(archived.map(session => [session.id, session]))
        setSessions(current => current.map(item => byId.get(item.id) || item))
        if (!showArchived && archived.some(session => session.id === activeId)) {
          go(activeWorkspaceId, null, { replace: true })
        }
      }
      if (failure) setArchiveError(failure.reason && failure.reason.message ? failure.reason.message : 'Failed to archive sessions')
    } finally {
      setArchiveBusy(false)
    }
  }

  const pinSession = async (id, pinned) => {
    if (pinBusy) return
    setPinBusy(true)
    setPinError(null)
    try {
      const { session } = await api.setSessionPinned(id, pinned)
      setSessions(current => current.map(item => item.id === id ? session : item))
    } catch (error) { setPinError(error.message) }
    finally { setPinBusy(false) }
  }

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) || null
  const workspaceSessions = sessionsReadyFor === activeWorkspaceId ? sessions : []
  const activeSession = workspaceSessions.find((s) => s.id === activeId) || null
  const runningCount = runningJobs.filter(ACTIVE_JOB).length
  const panelAllowed = (id) => registry.panels.some((panel) => panel.id === id)
  const openEditor = panelAllowed(EDITOR_PANEL)
    ? (path) => go(activeWorkspaceId, activeId, { view: EDITOR_PANEL, ...(path ? { file: path } : {}) })
    : undefined

  const closePanel = (id) => go(activeWorkspaceId, activeId, { view: null, ...(PANEL_CLOSE_PARAMS[id] || {}) })

  const openPanel = (id) => {
    const panel = registry.panels.find((item) => item.id === id)
    if (!panel) return
    if (panel.placement === 'main') {
      const open = view === id
      go(activeWorkspaceId, activeId, { view: open ? null : id })
      if (!open) showChat()
      return
    }
    go(activeWorkspaceId, activeId, { view: id, ...(PANEL_OPEN_PARAMS[id] || {}) })
  }

  // Registry panel id -> component. Panels without an entry here are ignored.
  const PANEL_COMPONENTS = {
    analytics: () => (
      <AnalyticsView
        devId="moxixrf"
        workspaces={workspaces}
        providers={providers}
        onBack={() => closePanel('analytics')}
        onOpenSession={(run) => {
          go(run.workspaceId || activeWorkspaceId, run.sessionId, { view: null })
          showChat()
        }}
      />
    ),
    editor: () => (
      <EditorView
        devId="7ix0b98"
        workspaces={workspaces}
        workspace={workspace}
        workspaceId={activeWorkspaceId}
        file={file}
        onFileChange={onFileChange}
        onSelectWorkspace={(id) => go(id, null)}
        onBack={() => closePanel('editor')}
      />
    ),
    terminal: () => (
      <TerminalView
        devId="5vznodc"
        workspaces={workspaces}
        workspace={workspace}
        workspaceId={activeWorkspaceId}
        term={term}
        onTermChange={onTermChange}
        onSelectWorkspace={onTerminalWorkspace}
        onBack={() => closePanel('terminal')}
      />
    ),
    git: () => (
      <GitView
        devId="6v4w7zs"
        workspaces={workspaces}
        workspace={workspace}
        workspaceId={activeWorkspaceId}
        file={file}
        onFileChange={onFileChange}
        onSelectWorkspace={(id) => go(id, null)}
        onOpenFile={openEditor}
        onBack={() => closePanel('git')}
      />
    ),
    'code-stats': () => (
      <CodeStatsView
        devId="k3w8n5v"
        workspace={workspace}
        providers={providers}
        onCreated={onCreated}
        onClose={() => closePanel('code-stats')}
        onOpenFile={openEditor}
      />
    ),
    memories: () => (
      <MemoriesView
        devId="m5n8r3t"
        onBack={() => closePanel('memories')}
        onOpenSession={(sessionId) => api.getSession(sessionId).then(({ session }) => {
          go(session.workspaceId, session.id, { view: null })
          showChat()
        })}
      />
    ),
    registry: () => (
      <RegistryView
        devId="r6g3x9v"
        workspaces={workspaces}
        providers={providers}
        workspaceId={activeWorkspaceId}
        onBack={() => closePanel('registry')}
      />
    ),
  }
  const activePanel = registry.panels.find((panel) => panel.id === view && PANEL_COMPONENTS[panel.id]) || null

  const sidebar = (
    <SessionsSidebar
      devId="hr5r1c6"
      workspaces={workspaces}
      workspace={workspace}
      sessions={workspaceSessions.filter(session => showArchived || !session.archived)}
      showArchived={showArchived}
      onShowArchived={(value) => {
        setShowArchived(value)
        if (!value && activeSession?.archived) go(activeWorkspaceId, null, { replace: true })
      }}
      onArchive={archiveSession}
      onArchiveOlder={archiveOlderSessions}
      archiveBusy={archiveBusy}
      archiveError={archiveError}
      onPin={pinSession}
      pinBusy={pinBusy}
      pinError={pinError}
      providers={providers}
      activeId={activeId}
      onSelectWorkspace={onSelectWorkspace}
      onSelect={(id) => {
        go(activeWorkspaceId, id, { view: null })
        showChat()
      }}
      onRename={renameSession}
      onWorkspaceCreated={onWorkspaceCreated}
      onWorkspaceUpdated={onWorkspaceUpdated}
      onDeleteWorkspace={deleteWorkspace}
      onCreated={onCreated}
      panels={registry.panels}
      view={activePanel ? view : null}
      onOpenPanel={openPanel}
      transcriptFontSize={transcriptFontSize}
      onTranscriptFontSize={changeTranscriptFontSize}
      settingsError={settingsError}
    />
  )

  const mainPane = (
    <main className="app__main">
      {activePanel?.placement === 'main' ? (
        PANEL_COMPONENTS[activePanel.id]()
      ) : activeId ? (
        <SessionView
          key={activeId}
          devId="hr2f3k7"
          sessionId={activeId}
          initialSession={activeSession}
          providers={providers}
          workspaces={workspaces}
          modes={registry.modes}
          onCreated={onCreated}
          transcriptFontSize={transcriptFontSize}
          onChanged={() => {
            loadSessions()
            loadRunningJobs()
          }}
        />
      ) : (
        <AppPlaceholder
          workspace={workspace}
          workspaces={workspaces}
          sessions={workspaceSessions}
          providers={providers}
          modes={registry.modes}
          onCreated={onCreated}
          onWorkspaceCreated={onWorkspaceCreated}
          onOpenEditor={openEditor && (() => openEditor())}
        />
      )}
    </main>
  )

  const jobsNav = (
    <RunningJobsNav
      devId="hr3v8p2"
      jobs={runningJobs}
      workspaces={workspaces}
      activeId={activeId}
      onSelect={onSelectJob}
      collapsed={mobile ? false : jobsCollapsed}
      onCollapsedChange={setJobsCollapsed}
    />
  )

  return (
    <DevInspector enabled={import.meta.env.DEV} forms={harnessForms(activeWorkspaceId)} views={harnessViews}>
      <DevScope id="hr7k2m9" state={{ workspace: activeWorkspaceId, session: activeId, view: activePanel ? view : 'sessions', file, term, running: runningCount, mobile }}>
        {activePanel?.placement === 'page' ? (
          PANEL_COMPONENTS[activePanel.id]()
        ) : mobile ? (
          <DevScope id="m4q8z2t" state={{ pane: mobilePane }}>
            <div className="app app--mobile">
              <div className={`app__mobile-pane${mobilePane === MOBILE_SESSIONS ? '' : ' app__mobile-pane--hidden'}`}>
                {sidebar}
              </div>
              <div className={`app__mobile-pane${mobilePane === MOBILE_CHAT ? '' : ' app__mobile-pane--hidden'}`}>
                {mainPane}
              </div>
              <div className={`app__mobile-pane${mobilePane === MOBILE_JOBS ? '' : ' app__mobile-pane--hidden'}`}>
                {jobsNav}
              </div>
              <nav className="app__mobile-nav">
                <TabsDisplay index={mobilePane} select={setMobilePane}>
                  <TabList>
                    <Tab>Sessions</Tab>
                    <Tab>Chat</Tab>
                    <Tab>
                      Jobs
                      {runningCount > 0 && <Badge size="small" variant="info" count={runningCount} />}
                    </Tab>
                  </TabList>
                </TabsDisplay>
              </nav>
            </div>
          </DevScope>
        ) : (
          <div className="app">
            <SplitPane
              direction="horizontal"
              defaultSize={320}
              minSize={260}
              maxSize={500}
              storageKey="harness.sidebar.width"
              devId="w1n6c4y"
            >
              {sidebar}
              <div className="app__content">
                <SplitPane
                  className="app__jobs-split"
                  direction="horizontal"
                  primary="second"
                  defaultSize={280}
                  minSize={200}
                  maxSize={520}
                  fixedSize={jobsCollapsed ? 38 : null}
                  storageKey="harness.jobs.width"
                  devId="hr8j5p1"
                >
                  {mainPane}
                  {jobsNav}
                </SplitPane>
              </div>
            </SplitPane>
          </div>
        )}
      </DevScope>
    </DevInspector>
  )
}

export default App
