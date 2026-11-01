import { Card, CardHeader, CardSection, DevScope, Matrix, ProgressBar } from 'component-library'
import { formatNumber } from '../../../format'
import { formatAverage, vsDetail } from '../format'
import { perRunAverage, tokenUsage } from '../tokenMetrics'

const WorkspaceCard = ({ byWorkspace, totalTokens, workspaceName }) => {
  const maxWorkspaceTokens = byWorkspace[0]?.tokens.total || 1
  const workspaceRows = byWorkspace.map((entry) => ({
    id: entry.workspaceId || '(none)',
    ...entry,
    usage: tokenUsage(entry.tokens),
  }))

  return (
    <DevScope id="p4w9z2e" state={{ workspaces: workspaceRows.length }}>
      <Card>
        <CardHeader>By workspace</CardHeader>
        <CardSection>
          <Matrix
            devId="g8j2r5t"
            rowDevId="c3n7q1w"
            className="analytics__table analytics__table--page"
            label="Token usage and sessions by workspace"
            rowLabel="Workspace"
            rows={workspaceRows}
            columns={[
              { id: 'share', title: 'Token share' },
              { id: 'total', title: 'Tokens' },
              { id: 'reads', title: 'Reads' },
              { id: 'writes', title: 'Writes' },
              { id: 'sessions', title: 'Sessions' },
              { id: 'runs', title: 'Runs' },
              { id: 'avg', title: 'Avg tokens / run' },
            ]}
            renderRowHeader={(row) => (
              row.workspaceId
                ? workspaceName(row.workspaceId)
                : <span className="hint">(no workspace)</span>
            )}
            renderCell={(row, column) => {
              if (column.id === 'share') {
                return (
                  <ProgressBar
                    label={`${totalTokens ? Math.round((row.usage.total / totalTokens) * 1000) / 10 : 0}%`}
                    value={row.usage.total}
                    max={maxWorkspaceTokens}
                    addClassName="analytics__share"
                  />
                )
              }
              if (column.id === 'total') return formatNumber(row.usage.total)
              if (column.id === 'reads') return <span title={vsDetail(row.usage.reads) || undefined}>{formatNumber(row.usage.readTotal)}</span>
              if (column.id === 'writes') return <span title={vsDetail(row.usage.writes) || undefined}>{formatNumber(row.usage.writeTotal)}</span>
              if (column.id === 'avg') return formatAverage(perRunAverage(row.usage.total, row.tokens.runs))
              return formatNumber(row[column.id])
            }}
          />
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default WorkspaceCard
