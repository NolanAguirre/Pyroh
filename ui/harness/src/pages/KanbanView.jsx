import { Button, DevScope } from 'component-library'
import KanbanBoard from '../components/Kanban/KanbanBoard'
import UserSession from '../components/Kanban/UserSession'
import WorkspaceBoard from '../components/Kanban/WorkspaceBoard'
import '../components/Kanban/Kanban.css'

const KanbanView = ({ devId, onBack, scoped = false, workspace, providers = [], onCreated }) => {
  return <DevScope id={devId}><section className="kanban" role={scoped ? 'dialog' : undefined} aria-modal={scoped ? true : undefined} aria-label={scoped ? 'Workspace Kanban' : 'Kanban'}>
    <header className="kanban__toolbar row">
      <Button devId="n1fyw7n" variant="secondary" size="sm" onClick={onBack}>{scoped ? 'Close' : 'Back'}</Button>
      <h1>{scoped ? workspace?.name || 'Workspace Kanban' : 'Kanban'}</h1>
    </header>
    {scoped && !workspace ? <p className="kanban__loading">Select a workspace to open its board.</p> : <UserSession devId="fa0exlc">{(user, onSwitchUser) => {
      if (scoped) return <WorkspaceBoard key={workspace.id} workspace={workspace} providers={providers} onCreated={onCreated} devId="gh7wfzh" user={user} onSwitchUser={onSwitchUser} />
      return <KanbanBoard workspace={workspace} providers={providers} onCreated={onCreated} devId="gh7wfzh" user={user} onSwitchUser={onSwitchUser} />
    }}</UserSession>}
  </section></DevScope>
}

export default KanbanView
