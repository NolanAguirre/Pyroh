import { useState } from 'react'
import { Card, CardHeader, CardSection, CardRow, CardLabel, DevScope, ProgressBar, Timeline } from 'component-library'
import { formatNumber, formatDuration, formatCompactNumber } from '../format'

const TokenBar = ({ label, value, total }) => (
  <DevScope id="hr9z4m1" state={{ label }}>
    <ProgressBar
      label={`${label} · ${formatNumber(value)}`}
      value={value}
      max={total || 1}
      status="done"
      addClassName="metric-bar"
    />
  </DevScope>
)

const MetricsPanel = ({ devId, session, runs }) => {
  const [selectedId, setSelectedId] = useState(null)
  const tokens = session?.totals?.tokens || {}
  const total = tokens.total || 0
  const cacheRead = tokens.cacheRead || 0
  const cacheWrite = tokens.cacheWrite || 0
  const freshInput = Math.max(0, (tokens.input || 0) - cacheRead)
  const ownRuns = runs.filter((run) => !run.inherited)
  const durationMs = session?.totals?.durationMs || 0
  const context = session?.context
  const used = context?.usedTokens
  const capacity = context?.maxTokens
  const hasContext = Number.isFinite(used) && used >= 0
  const hasCapacity = Number.isFinite(capacity) && capacity > 0
  const contextHint = context?.status === 'compacting' ? 'Compacting context…'
    : context?.status === 'awaiting_update' ? 'Compacted · awaiting next context report'
      : hasContext ? 'Latest provider report · updates as the agent runs'
        : ['codex', 'grok', 'claude'].includes(session?.provider) ? 'Waiting for a provider context report'
          : 'Context size unavailable from this provider'

  const base = ownRuns.length ? Math.min(...ownRuns.map((r) => r.startedAt)) : 0
  const now = Date.now()
  const points = ownRuns.map((r) => ({
    id: r.id,
    start: Math.max(0, Math.round(((r.startedAt || base) - base) / 1000)),
    end: Math.max(1, Math.round(((r.endedAt || now) - base) / 1000)),
    label: r.mode,
  }))
  const max = points.length ? Math.max(...points.map((p) => p.end)) || 1 : 1

  return (
    <DevScope id={devId} state={{ run: selectedId }}>
      <div className="metrics">
        <DevScope id="x8p2v6q" state={{ available: hasContext, status: context?.status }}>
          <Card>
            <CardHeader>Active Context</CardHeader>
            <CardSection>
              <div className="metrics__num">
                {hasContext ? formatNumber(used) : '—'}
                <span className="metrics__lbl-inline">{hasContext ? ` / ${hasCapacity ? formatNumber(capacity) : 'unknown'} tokens` : ''}</span>
              </div>
              {hasContext && hasCapacity && (
                <ProgressBar
                  label={`${Math.round((used / capacity) * 100)}% of window used`}
                  value={Math.min(used, capacity)}
                  max={capacity}
                  showValue
                  status={used >= capacity * 0.9 ? 'failed' : 'uploading'}
                  addClassName="metric-bar"
                />
              )}
              <p className="metrics__lbl" title={context?.updatedAt ? new Date(context.updatedAt).toLocaleString() : undefined}>
                {contextHint}
              </p>
            </CardSection>
          </Card>
        </DevScope>

        <Card>
          <CardRow>
            <CardSection>
              <CardLabel>Total Tokens</CardLabel>
              <div className="metrics__stat-val">{formatCompactNumber(total)}</div>
              <div className="metrics__stat-sub">{formatNumber(total)} tok</div>
            </CardSection>
            <CardSection>
              <CardLabel>Duration</CardLabel>
              <div className="metrics__stat-val">{formatDuration(durationMs)}</div>
              <div className="metrics__stat-sub">{Math.round(durationMs / 1000)}s</div>
            </CardSection>
            <CardSection>
              <CardLabel>Runs</CardLabel>
              <div className="metrics__stat-val">{ownRuns.length}</div>
              <div className="metrics__stat-sub">turns</div>
            </CardSection>
          </CardRow>
          <CardSection>
            <CardLabel>Token Distribution</CardLabel>
            <div className="metrics__bars">
              <TokenBar label="Fresh input" value={freshInput} total={total} />
              <TokenBar label="Cached input (measured)" value={cacheRead} total={total} />
              <TokenBar label="Output" value={tokens.output || 0} total={total} />
            </div>
            <p className="metrics__lbl">Cache reuse is measured from provider reports, not guaranteed. Fresh input includes cache writes.</p>
            {session?.fork?.kind === 'native' && session.cacheConfiguration && (
              <p className="metrics__lbl">
                {!session.cacheConfiguration.sourceKnown ? 'The source predates saved tool configuration; comparison is unavailable.'
                  : `Compared with source: MCP endpoints ${session.cacheConfiguration.mcpEndpointsChanged ? 'changed' : 'unchanged'}; tool configuration ${session.cacheConfiguration.toolConfigurationChanged || session.cacheConfiguration.delegationDefinitionsChanged ? 'changed' : 'unchanged'}.`}
                {' '}The effect on the provider’s cache prefix is unknown.
              </p>
            )}
            {cacheWrite > 0 && <p className="metrics__lbl">Cache writes within fresh input: {formatNumber(cacheWrite)} tokens</p>}
            {(tokens.reasoning || 0) > 0 && <p className="metrics__lbl">Reasoning within output: {formatNumber(tokens.reasoning)} tokens</p>}
          </CardSection>
        </Card>

        {points.length > 0 && (
          <DevScope id="hr7x1c4">
            <Card>
              <CardHeader>Run Timeline</CardHeader>
              <CardSection>
                <div className="metrics__timeline">
                  <Timeline
                    points={points}
                    min={0}
                    max={max}
                    tickCount={5}
                    selectedId={selectedId}
                    select={setSelectedId}
                    move={() => {}}
                  />
                </div>
              </CardSection>
            </Card>
          </DevScope>
        )}
      </div>
    </DevScope>
  )
}

export default MetricsPanel
