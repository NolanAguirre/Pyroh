import { Card, CardHeader, CardLabel, CardRow, CardSection, DevScope, Matrix } from 'component-library'
import { formatNumber } from '../../../format'
import { formatTs, ioDetail, ioText, vsDetail, vsText } from '../format'
import Stat from '../Stat'

const PerRunCard = ({ perRun, onOpenSession }) => (
  <DevScope id="xvkcchh" state={{ runs: perRun.runs, inOut: perRun.tokens.inputPerOutput, buildInOut: perRun.buildTokens?.inputPerOutput }}>
    <Card>
      <CardHeader>Per run</CardHeader>
      <CardRow>
        <Stat label="Mean" value={perRun.mean} />
        <Stat label="Median" value={perRun.median} />
        <Stat label="p90" value={perRun.p90} />
        <Stat label="Max" value={perRun.max} />
      </CardRow>
      <CardRow>
        <Stat label="Cache vs new reads" value={vsText(perRun.tokens.reads)} sub={vsDetail(perRun.tokens.reads)} />
        <Stat label="Input : output" value={ioText(perRun.tokens)} sub={ioDetail(perRun.tokens)} />
        <Stat label="Input : output (no plan/ask)" value={ioText(perRun.buildTokens)} sub={ioDetail(perRun.buildTokens)} />
      </CardRow>
      <CardSection>
        <CardLabel>Busiest runs</CardLabel>
        <Matrix
          devId="bv8stfy"
          rowDevId="emsmoja"
          className="analytics__table"
          label="Busiest runs"
          rowLabel="Run"
          rows={perRun.top.map((run) => ({ id: `${run.sessionId}:${run.runId}`, ...run }))}
          columns={[
            { id: 'session', title: 'Session' },
            { id: 'provider', title: 'Provider' },
            { id: 'started', title: 'Started' },
            { id: 'count', title: 'Calls' },
            { id: 'reads', title: 'Cache vs new reads' },
            { id: 'io', title: 'In : out' },
          ]}
          renderRowHeader={(row) => (
            <button
              type="button"
              className="analytics__link"
              title="Open session"
              onClick={() => onOpenSession(row)}
            >
              {row.runId || '—'}
            </button>
          )}
          renderCell={(row, column) => {
            if (column.id === 'session') return <code>{row.sessionId}</code>
            if (column.id === 'provider') return row.step ? `${row.provider} · ${row.step}` : row.provider
            if (column.id === 'started') return formatTs(row.firstTs)
            if (column.id === 'reads') return <span title={vsDetail(row.tokens?.reads) || undefined}>{vsText(row.tokens?.reads)}</span>
            if (column.id === 'io') return <span title={ioDetail(row.tokens) || undefined}>{ioText(row.tokens)}</span>
            return formatNumber(row.count)
          }}
        />
      </CardSection>
    </Card>
  </DevScope>
)

export default PerRunCard
