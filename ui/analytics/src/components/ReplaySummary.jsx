import { Badge, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { date, number, signed, shortId } from '../common/format.js'

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests']
const labels = { input: 'Input tokens', output: 'Output tokens', cacheRead: 'Cache read', cacheWrite: 'Cache write', fresh: 'Fresh tokens', reasoning: 'Reasoning', total: 'Total tokens', requests: 'Requests' }

export const ReplaySummary = ({ replay }) => {
  const measured = replay.measured.combined.total
  return <div className="summary-grid"><Metric label="Measured combined tokens" value={number(measured.value)} detail={`${number(measured.coveredRuns)} / ${number(measured.runs)} runs with total usage`} /><Metric label="Coordinator replay estimate" value={number(replay.estimate.total.estimate)} detail="Visible-context scenario · tokens" /><Metric label="Estimate − measured" value={signed(replay.estimate.difference.estimate)} detail="Positive means more estimated tokens" /><Metric label="Removed blocks / requests" value={`${number(replay.removed.blocks)} / ${number(replay.removed.turns)}`} detail={`${number(replay.replayTurns.length)} requests remain in replay`} /></div>
}

export const Coverage = ({ replay, onSelect }) => {
  const coverage = replay.coverage
  return <Panel title="Evidence & coverage" description={`Captured through ${date(replay.cutoff)}`} aside={<Badge tone={coverage.complete ? 'retain' : 'warning'}>{coverage.complete ? 'Complete' : 'Partial evidence'}</Badge>}>
    <div className="coverage-grid"><div><strong>{coverage.measuredUsageComplete ? 'Complete measured usage' : 'Incomplete measured coverage'}</strong><p className="muted">{number(replay.confidenceCounts.measured)} measured · {number(replay.confidenceCounts.inferred)} inferred · {number(replay.confidenceCounts.allocated)} allocated request boundaries</p></div><div><strong>{number(coverage.unplacedSessions.length)} unplaced sessions</strong><p className="muted">{number(coverage.gaps.length)} evidence gaps · {number(replay.ordering.insertions.filter(item => item.inferred).length)} inferred joins</p></div></div>
    <p className="alert alert--warning">{replay.estimate.total.upper === null ? 'The estimate has an unknown upper bound. Missing context and provider framing are not treated as zero.' : 'The estimate is a scenario based on recorded work.'}</p>
    {!!coverage.unplacedSessions.length && <p><strong>Unplaced:</strong> <span className="monospace">{coverage.unplacedSessions.join(', ')}</span>. Their measured usage remains in the baseline where available.</p>}
    {coverage.firstUnsupportedTurn && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: coverage.firstUnsupportedTurn })}>Inspect first unsupported request</button>}
    <details className="disclosure"><summary>Gap reasons ({number(coverage.gapReasons.length)})</summary><PagedItems items={coverage.gapReasons}>{(gap, index) => <div className="detail" key={index}><strong>{gap.reason}</strong><p className="muted">{number(gap.count)} occurrence{gap.count === 1 ? '' : 's'}</p></div>}</PagedItems></details>
    <details className="disclosure"><summary>Individual evidence gaps ({number(coverage.gaps.length)})</summary><PagedItems items={coverage.gaps}>{(gap, index) => <div className="detail" key={index}><p>{gap.reason}</p><div className="row">{gap.sessionId && <span className="monospace">{shortId(gap.sessionId)}</span>}{gap.blockId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'block', id: gap.blockId })}>Inspect block</button>}{gap.turnId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: gap.turnId })}>Inspect request</button>}</div></div>}</PagedItems></details>
  </Panel>
}

export const ComparisonStage = ({ replay, onSelect }) => {
  const maxTokens = Math.max(replay.measured.combined.total.value || 0, replay.estimate.total.estimate || 0, 1)
  return <div className="column">
    <Panel title="Actual usage → coordinator scenario" description={replay.estimate.scope}>
      <div className="comparison">{[
        ['Measured combined', replay.measured.combined.total.value],
        ['Replay estimate', replay.estimate.total.estimate],
      ].map(([label, value]) => <div key={label}><div className="row"><strong>{label}</strong><span>{number(value)} tokens</span></div><div className="token-bar" role="img" aria-label={`${label}: ${number(value)} tokens`}><div className="token-bar__fill" style={{ width: `${Number.isFinite(value) ? value / maxTokens * 100 : 0}%` }} /></div></div>)}</div>
      <p>{replay.estimate.difference.meaning}</p>
      <div className="table-scroll"><table className="data-table"><caption>Replay point estimates and reported bounds, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Point estimate</th><th scope="col">Lower bound</th><th scope="col">Upper bound</th></tr></thead><tbody>{['input', 'output', 'total', 'difference'].map(field => <tr key={field}><th scope="row">{field === 'difference' ? 'Estimate − measured' : labels[field]}</th><td>{field === 'difference' ? signed(replay.estimate[field].estimate) : number(replay.estimate[field].estimate)}</td><td>{field === 'difference' ? signed(replay.estimate[field].lower) : number(replay.estimate[field].lower)}</td><td>{replay.estimate[field].upper === null ? 'Unknown / unbounded' : number(replay.estimate[field].upper)}</td></tr>)}</tbody></table></div>
    </Panel>
    <Panel title="Measured baseline" description="Exact values from the replay. Cache and reasoning fields may overlap other categories and are not added together here.">
      <div className="table-scroll"><table className="data-table"><caption>Reported usage by original session group</caption><thead><tr><th scope="col">Usage</th><th scope="col">Coordinator</th><th scope="col">Descendants</th><th scope="col">Combined</th></tr></thead><tbody>{fields.map(field => <tr key={field}><th scope="row">{labels[field]}</th>{['coordinator', 'descendants', 'combined'].map(group => {
        const item = replay.measured[group][field]
        return <td key={group}><strong>{number(item.value)}</strong><div className="muted">{number(item.coveredRuns)} / {number(item.runs)} runs</div>{item.value === null && <div className="muted">Known subtotal: {number(item.knownSubtotal)}</div>}</td>
      })}</tr>)}</tbody></table></div>
    </Panel>
    {replay.finalAnswer && <Panel title="Final answer provenance" description={replay.finalAnswer.substituted ? 'The original final relay is replaced by retained findings.' : 'The original final answer remains.'}><div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'block', id: replay.finalAnswer.originalBlockId })}>Original final block</button></div><PagedItems items={replay.finalAnswer.retainedBlockIds}>{id => <button className="button button--quiet" key={id} onClick={() => onSelect({ kind: 'block', id })}>Retained answer: {shortId(id)}</button>}</PagedItems></Panel>}
    <Panel title="Measured runs" description="Original run totals remain separate from the reconstructed conversation."><PagedItems items={replay.measuredRuns} size={8}>{run => <div className="detail" key={`${run.sessionId}:${run.runId}`}><div className="row"><strong>{run.model || 'Unknown model'}</strong><Badge>{run.status || 'Unknown status'}</Badge></div><p className="monospace">{run.sessionId} / {run.runId}</p><p className="muted">{run.provider || 'Unknown provider'} · {run.source || 'No usage source'}</p><div className="row"><span>Input {number(run.usage.input)}</span><span>Output {number(run.usage.output)}</span><strong>Total {number(run.usage.total)}</strong></div></div>}</PagedItems></Panel>
    <Panel title="Scenario assumptions" description="These are the estimator’s own rules and limitations."><PagedItems items={replay.assumptions} size={8}>{(assumption, index) => <p key={index}>{assumption}</p>}</PagedItems></Panel>
  </div>
}
