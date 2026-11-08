import { Card, CardHeader, CardLabel, CardSection, Matrix } from 'component-library'
import { urlWithSelection } from '../../../appUrl'
import { formatNumber, formatDuration } from '../../../format'

const SubagentsCard = ({ subagents }) => {
  const harness = subagents.harness
  const total = usage => (usage?.reads.cache || 0) + (usage?.reads.fresh || 0) + (usage?.writes.cache || 0) + (usage?.writes.fresh || 0)
  const scopeRows = subagents
    ? [
      { id: 'top-level', label: 'Top-level runs', ...subagents.decompose.topLevel },
      ...subagents.decompose.steps.map((entry) => ({ id: `step:${entry.step}`, label: `Decompose ${entry.step}`, ...entry })),
    ]
    : []

  return (
    <Card>
      <CardHeader>Subagents &amp; decompose</CardHeader>
      {harness && <CardSection>
        <CardLabel>Harness children ({formatNumber(harness.count)})</CardLabel>
        <p className="hint">{harness.outcomes.map(item => `${item.status}: ${item.count}`).join(' · ') || 'No children'} · {formatDuration(harness.durationMs)}</p>
        <p className="hint">Reported tokens in this selection: direct parents {formatNumber(total(harness.directUsage))} · children {formatNumber(total(harness.childUsage))} · combined {formatNumber(total(harness.combinedUsage))}</p>
        <Matrix label="Harness child runs" rowLabel="Transcript"
          rows={harness.runs.map(run => ({ ...run, id: `${run.sessionId}:${run.runId}` }))}
          columns={[{ id: 'status', title: 'Outcome' }, { id: 'model', title: 'Provider / model' }, { id: 'durationMs', title: 'Duration' }, { id: 'usage', title: 'Reported tokens' }]}
          renderRowHeader={run => <a href={urlWithSelection(new URL(window.location.href), run.workspaceId, run.sessionId, null, null, null).href}>{run.runId}</a>}
          renderCell={(run, column) => column.id === 'model' ? `${run.provider} / ${run.model || 'default'}`
            : column.id === 'durationMs' ? formatDuration(run.durationMs)
              : column.id === 'usage' ? run.usage ? formatNumber(run.usage.total) : 'Not reported' : run.status || 'Unknown'}
        />
        <p className="hint">Full events and approvals remain in each child transcript.</p>
      </CardSection>}
      <CardSection>
        <CardLabel>Native task spawns ({formatNumber(subagents.tasks.total)})</CardLabel>
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
        <p className="hint">Native subagent tool calls are not recorded in the parent transcript.</p>
      </CardSection>
    </Card>
  )
}

export default SubagentsCard
