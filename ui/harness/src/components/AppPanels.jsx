import EditorView from './Editor/EditorView'
import TerminalView from './Terminal/TerminalView'
import GitView from './Git/GitView'
import AnalyticsView from './Analytics/AnalyticsView'
import CodeStatsView from './CodeStats/CodeStatsView'
import RegistryView from './Registry/RegistryView'
import MemoriesView from './Memories/MemoriesView'
import api from '../api'

// Panels come from the registry; `?view=` holds the open panel id.
export const EDITOR_PANEL = 'editor'
// Extra URL changes when a panel opens or closes.
export const PANEL_OPEN_PARAMS = { git: { file: null } }
export const PANEL_CLOSE_PARAMS = { terminal: { term: null }, git: { file: null } }

// Registry panel id -> component. Panels without an entry here are ignored.
export const createPanelComponents = ({
  workspaces,
  workspace,
  workspaceId,
  providers,
  file,
  term,
  onFileChange,
  onTermChange,
  onTerminalWorkspace,
  onSelectWorkspace,
  onOpenSession,
  onOpenFile,
  onCreated,
  closePanel,
}) => ({
  analytics: () => (
    <AnalyticsView
      devId="moxixrf"
      workspaces={workspaces}
      providers={providers}
      onBack={() => closePanel('analytics')}
      onOpenSession={(run) => onOpenSession(run.workspaceId || workspaceId, run.sessionId)}
    />
  ),
  editor: () => (
    <EditorView
      devId="7ix0b98"
      workspaces={workspaces}
      workspace={workspace}
      workspaceId={workspaceId}
      file={file}
      onFileChange={onFileChange}
      onSelectWorkspace={onSelectWorkspace}
      onBack={() => closePanel('editor')}
    />
  ),
  terminal: () => (
    <TerminalView
      devId="5vznodc"
      workspaces={workspaces}
      workspace={workspace}
      workspaceId={workspaceId}
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
      workspaceId={workspaceId}
      file={file}
      onFileChange={onFileChange}
      onSelectWorkspace={onSelectWorkspace}
      onOpenFile={onOpenFile}
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
      onOpenFile={onOpenFile}
    />
  ),
  memories: () => (
    <MemoriesView
      devId="m5n8r3t"
      onBack={() => closePanel('memories')}
      onOpenSession={(sessionId) => api.getSession(sessionId).then(({ session }) => {
        onOpenSession(session.workspaceId, session.id)
      })}
    />
  ),
  registry: () => (
    <RegistryView
      devId="r6g3x9v"
      workspaces={workspaces}
      providers={providers}
      workspaceId={workspaceId}
      onBack={() => closePanel('registry')}
    />
  ),
})
