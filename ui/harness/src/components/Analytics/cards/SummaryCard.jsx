import { useState } from 'react'
import { Card, CardHeader, CardRow, DevScope, DropdownTypeahead, DropdownTypeaheadMenu, DropdownTypeaheadTrigger, Fold, FoldContent, FoldTrigger } from 'component-library'
import { formatNumber } from '../../../format'
import { formatAverage, formatTs } from '../format'
import { tokenMetrics } from '../tokenMetrics'
import Stat from '../Stat'

const UsageCard = ({ title, tokens }) => {
  const metrics = tokenMetrics(tokens)

  return (
    <div className="analytics__usage">
      <Card>
        <CardHeader>
          {title}
          <span className="analytics__usage-runs">{formatNumber(metrics.runs)} runs</span>
        </CardHeader>
        <div className="analytics__tokens">
          <div className="analytics__token-row">
            {metrics.rows.map((row) => (
              <div key={row.id} className="analytics__token" title={row.note || undefined}>
                <span className="analytics__token-label">{row.label}</span>
                <span className="analytics__token-value">{formatNumber(row.total)}</span>
                {row.note && <span className="analytics__token-note">{row.note}</span>}
              </div>
            ))}
          </div>
          <div className="analytics__token-row">
            {metrics.rows.map((row) => (
              <div key={`${row.id}-avg`} className="analytics__token">
                <span className="analytics__token-label">Avg {row.label.toLowerCase()}</span>
                <span className="analytics__token-value">{formatAverage(row.avg)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

const ModelUsage = ({ byModel }) => {
  const [model, setModel] = useState('')
  const options = byModel.map((row) => ({ value: row.model, displayValue: row.model }))
  const selected = byModel.find((row) => row.model === model)

  if (byModel.length === 0) return null

  const rows = selected ? [selected] : byModel

  return (
    <div className="analytics__models">
      <DropdownTypeahead
        defaultValue={model}
        options={options}
        change={setModel}
        filterable
      >
        <DropdownTypeaheadTrigger placeholder="Search models" />
        <DropdownTypeaheadMenu filterPlaceholder="Search models" emptyMessage="No models" />
      </DropdownTypeahead>
      <Fold>
        <FoldTrigger>Models</FoldTrigger>
        <FoldContent>
          {rows.map((row) => (
            <UsageCard key={row.model} title={row.model} tokens={row.tokens} />
          ))}
        </FoldContent>
      </Fold>
    </div>
  )
}

const SummaryCard = ({ totals, perRun }) => {
  const metrics = tokenMetrics(perRun?.tokens)
  const usage = metrics.usage
  const byModel = perRun?.tokensByModel || []

  return (
    <DevScope id="cwow06k" state={{ calls: totals.calls }}>
      <div className="analytics__summary">
        <Card>
          <CardRow>
            <Stat label="Tool calls" value={formatNumber(totals.calls)} />
            <Stat label="Runs" value={formatNumber(totals.runs)} sub={`${perRun.mean} calls / run`} />
            <Stat label="Sessions" value={formatNumber(totals.sessions)} />
          </CardRow>
          <CardRow>
            <Stat label="First call" value={formatTs(totals.first)} />
            <Stat label="Last call" value={formatTs(totals.last)} />
          </CardRow>
        </Card>
        <DevScope id="w7tq2na" state={{ runs: metrics.runs, total: usage.total, avg: metrics.rows[0].avg, reads: usage.readTotal, writes: usage.writeTotal }}>
          <UsageCard title="Token usage" tokens={perRun?.tokens} />
        </DevScope>
        <ModelUsage byModel={byModel} />
      </div>
    </DevScope>
  )
}

export default SummaryCard
