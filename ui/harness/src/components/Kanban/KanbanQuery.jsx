import { cloneElement, useEffect, useMemo, useSyncExternalStore } from 'react'
import { Button, DevScope } from 'component-library'
import { client } from './client'

const KanbanQuery = ({ devId, query, variables = {}, children }) => {
  const variablesKey = JSON.stringify(variables)
  const entry = useMemo(() => client.query(query, JSON.parse(variablesKey)), [query, variablesKey])
  const snapshot = useSyncExternalStore(entry.subscribe, entry.snapshot, entry.snapshot)
  useEffect(() => { entry.load().catch(() => {}) }, [entry])
  return <DevScope id={devId}>
    {snapshot.error && <DevScope id="f84ws79"><div className="kanban__error-banner" role="alert">
      {snapshot.error.message}
      <Button devId="r7r4oxt" variant="secondary" size="sm" disabled={snapshot.loading} onClick={() => entry.load().catch(() => {})}>Retry</Button>
    </div></DevScope>}
    {!snapshot.data && snapshot.loading && <DevScope id="3q9s49i"><p className="kanban__loading" role="status">Loading Kanban…</p></DevScope>}
    {snapshot.data && cloneElement(children, snapshot.data)}
  </DevScope>
}

export default KanbanQuery
