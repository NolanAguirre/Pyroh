import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createHarnessPlugin,
  DevInspector,
  DevScope,
  useBrowserLocation,
  useMediaQuery,
} from 'component-library'
import SessionsSidebar from './components/SessionsSidebar'
import SessionView from './components/SessionView'
import RunningJobsNav from './components/RunningJobsNav'
import AppPlaceholder from './components/AppPlaceholder'
import { DesktopLayout, MobileLayout, MOBILE_CHAT, MOBILE_SESSIONS } from './components/AppLayout'
import { createPanelComponents, EDITOR_PANEL, PANEL_CLOSE_PARAMS, PANEL_OPEN_PARAMS } from './components/AppPanels'
import { restoreStoredWorkspace, selectionFromUrl, storeWorkspace, urlWithSelection } from './appUrl'
import useWorkspaces from './useWorkspaces'
import useWorkspaceSessions from './useWorkspaceSessions'
import useRunningJobs, { ACTIVE_JOB } from './useRunningJobs'
import useRegistry from './useRegistry'
import useTranscriptFontSize from './useTranscriptFontSize'
import api from './api'
import './App.css'

const HARNESS_WORKSPACE = { name: 'harness', cwdPatterns: [/\/ui\/harness\/?$/, /\/harness\/?$/], label: 'the harness workspace' }
const MOBILE_QUERY = '(max-width: 768px)'

restoreStoredWorkspace()

const App = () => {
  const { url, navigate } = useBrowserLocation()
  const { workspaceId: activeWorkspaceId, sessionId: activeId, view, file, term } = selectionFromUrl(url)
  const harnessPlugin = useMemo(() => createHarnessPlugin({
    client: api, workspace: HARNESS_WORKSPACE, preferredWorkspaceId: activeWorkspaceId,
  }), [activeWorkspaceId])
  const mobile = useMediaQuery(MOBILE_QUERY)
  const [mobilePane, setMobilePane] = useState(() => (activeId ? MOBILE_CHAT : MOBILE_SESSIONS))
  const showChat = () => setMobilePane(MOBILE_CHAT)
  const [providers, setProviders] = useState([])
  const [jobsCollapsed, setJobsCollapsed] = useState(false)

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

  const { workspaces, workspacesLoaded, putWorkspace, deleteWorkspace } = useWorkspaces()

  useEffect(() => {
    api
      .getProviders()
      .then(({ providers: list }) => setProviders(list))
      .catch(() => setProviders([]))
  }, [])

  const { transcriptFontSize, changeTranscriptFontSize, settingsError } = useTranscriptFontSize()
  const leaveSession = () => go(activeWorkspaceId, null, { replace: true })
  const {
    sessions,
    sessionsReadyFor,
    sessionsHaveArchived,
    showArchived,
    setShowArchived,
    archiveBusy,
    archiveError,
    pinBusy,
    pinError,
    loadSessions,
    addSession,
    renameSession,
    archiveSession,
    archiveOlderSessions,
    pinSession,
  } = useWorkspaceSessions(activeWorkspaceId, activeId, leaveSession)
  const registry = useRegistry(activeWorkspaceId)
  const { runningJobs, loadRunningJobs } = useRunningJobs()

  useEffect(() => {
    if (!workspacesLoaded) return
    storeWorkspace(activeWorkspaceId)
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
  }, [activeId, activeWorkspaceId, sessions, sessionsReadyFor, sessionsHaveArchived, setShowArchived, go])

  useEffect(() => {
    const timer = setInterval(() => {
      loadSessions()
      loadRunningJobs()
    }, 3000)
    return () => clearInterval(timer)
  }, [loadSessions, loadRunningJobs])

  const onWorkspaceCreated = (workspace) => {
    putWorkspace(workspace)
    go(workspace.id, null)
  }

  const onCreated = (session) => {
    addSession(session)
    go(session.workspaceId || activeWorkspaceId, session.id, { view: null })
    showChat()
  }

  const onSelectWorkspace = (id) => {
    go(id, null)
  }

  const openSession = (workspaceId, sessionId) => {
    go(workspaceId, sessionId, { view: null })
    showChat()
  }

  const onSelectJob = (job) => openSession(job.workspaceId || activeWorkspaceId, job.id)

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

  const PANEL_COMPONENTS = createPanelComponents({
    workspaces,
    workspace,
    workspaceId: activeWorkspaceId,
    providers,
    file,
    term,
    onFileChange,
    onTermChange,
    onTerminalWorkspace,
    onSelectWorkspace,
    onOpenSession: openSession,
    onOpenFile: openEditor,
    onCreated,
    closePanel,
  })
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
      onSelect={(id) => openSession(activeWorkspaceId, id)}
      onRename={renameSession}
      onWorkspaceCreated={onWorkspaceCreated}
      onWorkspaceUpdated={putWorkspace}
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
    <DevInspector enabled={import.meta.env.DEV} forms={harnessPlugin.forms} views={harnessPlugin.views}>
      <DevScope id="hr7k2m9" state={{ workspace: activeWorkspaceId, session: activeId, view: activePanel ? view : 'sessions', file, term, running: runningCount, mobile }}>
        {activePanel?.placement === 'page' ? (
          PANEL_COMPONENTS[activePanel.id]()
        ) : mobile ? (
          <MobileLayout
            pane={mobilePane}
            onPane={setMobilePane}
            sidebar={sidebar}
            main={mainPane}
            jobs={jobsNav}
            runningCount={runningCount}
          />
        ) : (
          <DesktopLayout sidebar={sidebar} main={mainPane} jobs={jobsNav} jobsCollapsed={jobsCollapsed} />
        )}
      </DevScope>
    </DevInspector>
  )
}

export default App
