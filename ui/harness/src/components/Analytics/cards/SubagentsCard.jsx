import { Card, CardHeader, CardLabel, CardSection, DevScope, Matrix } from 'component-library'
import { formatNumber } from '../../../format'

const SubagentsCard = ({ subagents }) => {
  const scopeRows = subagents
    ? [
      { id: 'top-level', label: 'Top-level runs', ...subagents.decompose.topLevel },
      ...subagents.decompose.steps.map((entry) => ({ id: `step:${entry.step}`, label: `Decompose ${entry.step}`, ...entry })),
    ]
    : []

  return (
    <DevScope id="xftf0jj" state={{ spawns: subagents.tasks.total }}>
      <Card>
        <CardHeader>Subagents &amp; decompose</CardHeader>
        <CardSection>
          <CardLabel>Task spawns ({formatNumber(subagents.tasks.total)})</CardLabel>
          {subagents.tasks.total ? (
            <Matrix
              devId="k99hltr"
              rowDevId="kf44qza"
              className="analytics__table"
              label="Subagent spawns"
              rowLabel="Subagent"
              rows={subagents.tasks.byType.map((entry) => ({ id: entry.type, ...entry }))}
              columns={[{ id: 'count', title: 'Spawns' }]}
              renderRowHeader={(row) => row.type}
              renderCell={(row) => formatNumber(row.count)}
            />
          ) : (
            <p className="hint">No subagent spawns.</p>
          )}
        </CardSection>
        <CardSection>
          <CardLabel>Scope</CardLabel>
          <Matrix
            devId="vobasl9"
            rowDevId="yf6ilqv"
            className="analytics__table"
            label="Calls by scope"
            rowLabel="Scope"
            rows={scopeRows}
            columns={[{ id: 'count', title: 'Calls' }, { id: 'runs', title: 'Runs' }]}
            renderRowHeader={(row) => row.label}
            renderCell={(row, column) => formatNumber(row[column.id])}
          />
          <p className="hint">Tool calls made inside subagents are not recorded in the parent transcript.</p>
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default SubagentsCard
