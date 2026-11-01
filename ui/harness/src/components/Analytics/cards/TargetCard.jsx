import { Card, CardHeader, CardSection, DevScope, Matrix } from 'component-library'
import { formatNumber } from '../../../format'
import { formatTs } from '../format'

const targetTableRows = (rows, openTargets) => rows.flatMap((row) => {
  const target = { id: row.key, rowKind: 'target', ...row }
  if (!openTargets[row.key]) return [target]
  return [
    target,
    ...row.sessionCalls.map((session) => ({
      id: `${row.key}\0${session.sessionId}`,
      rowKind: 'session',
      ...session,
    })),
  ]
})

const renderTargetCell = (row, column) => {
  if (row.rowKind === 'session' && column.id === 'sessions') return '—'
  if (column.id === 'last') return formatTs(row.lastTs)
  return formatNumber(row[column.id])
}

const TargetCard = ({ targets, openTargets, toggleTarget, onOpenSession }) => (
  <DevScope id="fowik4x" state={{ tool: targets.tool, distinct: targets.distinct }}>
    <Card>
      <CardHeader>
        By target — {targets.tool}
        <span className="analytics__usage-runs">
          {`${formatNumber(targets.distinct)} distinct · ${formatNumber(targets.repeats)} same-run repeats · ${formatNumber(targets.exactRepeats)} identical`}
        </span>
      </CardHeader>
      <CardSection>
        <Matrix
          devId="g792lxx"
          rowDevId="9ymrir5"
          className="analytics__table"
          label={`${targets.tool} calls by target`}
          rowLabel="Target"
          rows={targetTableRows(targets.rows, openTargets)}
          columns={[
            { id: 'count', title: 'Calls' },
            { id: 'repeats', title: 'Same-run repeats' },
            { id: 'exactRepeats', title: 'Identical repeats' },
            { id: 'variants', title: 'Variants' },
            { id: 'runs', title: 'Runs' },
            { id: 'sessions', title: 'Sessions' },
            { id: 'last', title: 'Last call' },
          ]}
          renderRowHeader={(row) => (
            row.rowKind === 'session' ? (
              <DevScope id="0zglbv6" state={{ session: row.sessionId, count: row.count, repeats: row.repeats, exactRepeats: row.exactRepeats, variants: row.variants, runs: row.runs }}>
                <button
                  type="button"
                  className="analytics__link analytics__session-link"
                  title={`Open session ${row.sessionId}`}
                  onClick={() => onOpenSession(row)}
                >
                  {row.sessionName || row.sessionId}
                </button>
              </DevScope>
            ) : (
              <DevScope id="ovft33e" state={{ sessions: row.sessionCalls.length, open: !!openTargets[row.key] }}>
                <button
                  type="button"
                  className={`analytics__target-toggle${openTargets[row.key] ? ' analytics__target-toggle--open' : ''}`}
                  aria-expanded={!!openTargets[row.key]}
                  onClick={() => toggleTarget(row.key)}
                >
                  <code className="analytics__target" title={`${row.kind}: ${row.key}`}>{row.key}</code>
                  <span className="analytics__target-meta">
                    <span aria-hidden="true">{openTargets[row.key] ? '▲' : '▼'} </span>
                    {`${formatNumber(row.sessionCalls.length)} session${row.sessionCalls.length === 1 ? '' : 's'}`}
                  </span>
                </button>
              </DevScope>
            )
          )}
          renderCell={renderTargetCell}
        />
        {targets.truncated && <p className="hint">Showing top {formatNumber(targets.rows.length)} targets.</p>}
      </CardSection>
    </Card>
  </DevScope>
)

export default TargetCard
