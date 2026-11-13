import { Button, DevScope } from 'component-library'
import KanbanBoard from '../components/Kanban/KanbanBoard'
import UserSession from '../components/Kanban/UserSession'
import '../components/Kanban/Kanban.css'

const KanbanView = ({ devId, onBack }) => {
  return <DevScope id={devId}><section className="kanban" aria-label="Kanban">
    <header className="kanban__toolbar row">
      <Button devId="n1fyw7n" variant="secondary" size="sm" onClick={onBack}>Back</Button>
      <h1>Kanban</h1>
    </header>
    <UserSession devId="fa0exlc">{(user, onSwitchUser) => <KanbanBoard devId="gh7wfzh" user={user} onSwitchUser={onSwitchUser} />}</UserSession>
  </section></DevScope>
}

export default KanbanView
