import { Badge, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { date, number, signed, shortId } from '../common/format.js'

const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'fresh', 'reasoning', 'total', 'requests']
const labels = { input: 'Input tokens (includes cache)', output: 'Output tokens', cacheRead: 'Cache read', cacheWrite: 'Cache write', fresh: 'Fresh input tokens', reasoning: 'Reasoning', total: 'Total tokens', requests: 'Model calls' }

export const ReplaySummary = ({ replay }) => {
  const measured = replay.measured.combined.total
  return <div className="summary-grid"><Metric label="Measured combined tokens" value={number(measured.value)} detail={`${number(measured.coveredRuns)} / ${number(measured.runs)} runs with total usage`} /><Metric label="Coordinator replay estimate" value={number(replay.estimate.total.estimate)} detail="Input (including cache) + output · tokens" /><Metric label="Estimate − measured" value={signed(replay.estimate.difference.estimate)} detail="Positive means more estimated tokens" /><Metric label="Removed blocks / model calls" value={`${number(replay.removed.blocks)} / ${number(replay.removed.turns)}`} detail={`${number(replay.replayTurns.length)} model calls remain in replay (including inferred)`} /></div>
}

export const Coverage = ({ replay, onSelect }) => {
  const coverage = replay.coverage
  return <Panel title="Evidence & coverage" description={`Captured through ${date(replay.cutoff)}`} aside={<Badge tone={coverage.complete ? 'retain' : 'warning'}>{coverage.complete ? 'Complete' : 'Partial evidence'}</Badge>}>
    <div className="coverage-grid"><div><strong>{coverage.measuredUsageComplete ? 'Complete measured usage' : 'Incomplete measured coverage'}</strong><p className="muted">{number(replay.confidenceCounts.measured)} measured · {number(replay.confidenceCounts.inferred)} inferred · {number(replay.confidenceCounts.allocated)} allocated model-call boundaries</p></div><div><strong>{number(coverage.unplacedSessions.length)} unplaced sessions</strong><p className="muted">{number(coverage.gaps.length)} evidence gaps · {number(replay.ordering.insertions.filter(item => item.inferred).length)} inferred joins</p></div></div>
    <p className="alert alert--warning">{replay.estimate.total.upper === null ? 'The estimate has an unknown upper bound. Missing context and provider framing are not treated as zero.' : 'The estimate is a scenario based on recorded work.'}</p>
    {!!coverage.unplacedSessions.length && <p><strong>Unplaced:</strong> <span className="monospace">{coverage.unplacedSessions.join(', ')}</span>. Their measured usage remains in the baseline where available.</p>}
    {coverage.firstUnsupportedTurn && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: coverage.firstUnsupportedTurn })}>Inspect first unsupported model call</button>}
    <details className="disclosure"><summary>Gap reasons ({number(coverage.gapReasons.length)})</summary><PagedItems items={coverage.gapReasons}>{(gap, index) => <div className="detail" key={index}><strong>{gap.reason}</strong><p className="muted">{number(gap.count)} occurrence{gap.count === 1 ? '' : 's'}</p></div>}</PagedItems></details>
    <details className="disclosure"><summary>Individual evidence gaps ({number(coverage.gaps.length)})</summary><PagedItems items={coverage.gaps}>{(gap, index) => <div className="detail" key={index}><p>{gap.reason}</p><div className="row">{gap.sessionId && <span className="monospace">{shortId(gap.sessionId)}</span>}{gap.blockId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'block', id: gap.blockId })}>Inspect block</button>}{gap.turnId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: gap.turnId })}>Inspect model call</button>}</div></div>}</PagedItems></details>
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
      <div className="table-scroll"><table className="data-table"><caption>Replay point estimates and reported bounds, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Point estimate</th><th scope="col">Lower bound</th><th scope="col">Upper bound</th></tr></thead><tbody>{['input', 'cacheRead', 'fresh', 'output', 'total', 'difference'].map(field => {
        const range = replay.estimate[field]
        const format = field === 'difference' ? signed : number
        return <tr key={field}><th scope="row">{field === 'difference' ? 'Estimate − measured' : labels[field]}</th><td>{range ? format(range.estimate) : 'Not reported'}</td><td>{range ? format(range.lower) : 'Not reported'}</td><td>{!range ? 'Not reported' : range.upper === null ? 'Unknown / unbounded' : format(range.upper)}</td></tr>
      })}</tbody></table></div>
      <p className="muted">Input includes cache reads and fresh content. Cache reads are part of input and are not added again to the total.</p>
      <p className="muted"><strong>Replay caching assumption:</strong> {replay.estimate.cachingAssumption || 'No caching assumption was recorded in this result.'}</p>
      {(replay.estimate.cacheRead || replay.estimate.fresh || replay.estimate.cachingAssumption) && <p className="muted">Retained context sent in an earlier request is assumed cached. New content is fresh, including previous generated output and tool results when first sent as input. These are replay assumptions, separate from measured cache usage below.</p>}
    </Panel>
    <Panel title="Automatic aggregation" description="Replay input is the sum of full-history input counts across surviving model calls. Replay output is the sum of their once-charged generated output. Total = input + output. The comparison subtracts measured coordinator and descendant usage.">
      <div className="summary-grid"><Metric label="Replay model calls" value={number(replay.replayTurns.length)} /><Metric label="Summed input (includes cache)" value={number(replay.estimate.input.estimate)} /><Metric label="Estimated cache read" value={number(replay.estimate.cacheRead?.estimate)} /><Metric label="Estimated fresh input" value={number(replay.estimate.fresh?.estimate)} /><Metric label="Summed output" value={number(replay.estimate.output.estimate)} /><Metric label="Replay total" value={number(replay.estimate.total.estimate)} /></div>
      <p className="muted">Totals and model-call counts come from the service. Replay counts include inferred response boundaries; missing calls are not invented. Any unavailable token count keeps its aggregate unknown. Missing measured totals prevent a complete comparison. This compares tokens, including cached input, rather than cost.</p>
      <details className="disclosure"><summary>Per-model-call contributions ({number(replay.replayTurns.length)})</summary><PagedItems items={replay.replayTurns} size={8}>{request => <div className="detail" key={request.turnId}><div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.turnId })}>{shortId(request.turnId)}</button><Badge tone={request.confidence === 'measured' ? 'neutral' : 'warning'}>{request.confidence} boundary</Badge></div><p>{request.originalModel} → {request.model}</p><div className="row"><span>Input {number(request.input.estimate)}</span><span>Output {number(request.output.estimate)}</span><span>{number(request.requestBlockIds.length)} history blocks</span><span>{number(request.generatedBlockIds.length)} generated blocks</span></div></div>}</PagedItems></details>
    </Panel>
    <Panel title="Measured baseline" description="Exact values from the replay. Cache and reasoning fields may overlap other categories and are not added together here.">
      <div className="table-scroll"><table className="data-table"><caption>Reported usage by original session group</caption><thead><tr><th scope="col">Usage</th><th scope="col">Coordinator</th><th scope="col">Descendants</th><th scope="col">Combined</th></tr></thead><tbody>{fields.map(field => <tr key={field}><th scope="row">{labels[field]}</th>{['coordinator', 'descendants', 'combined'].map(group => {
        const item = replay.measured[group][field]
        return <td key={group}><strong>{number(item.value)}</strong><div className="muted">{number(item.coveredRuns)} / {number(item.runs)} runs</div>{item.value === null && <div className="muted">Known subtotal: {number(item.knownSubtotal)}</div>}</td>
      })}</tr>)}</tbody></table></div>
    </Panel>
    {replay.finalAnswer && <Panel title="Final answer provenance" description={replay.finalAnswer.substituted ? 'The original final relay is replaced by retained findings.' : 'The original final answer remains.'}><div className="row"><button className="button button--quiet" onClick={() => onSelect({ kind: 'block', id: replay.finalAnswer.originalBlockId })}>Original final block</button></div><PagedItems items={replay.finalAnswer.retainedBlockIds}>{id => <button className="button button--quiet" key={id} onClick={() => onSelect({ kind: 'block', id })}>Retained answer: {shortId(id)}</button>}</PagedItems></Panel>}
    <Panel title="Measured runs" description="Original run totals remain separate from the reconstructed conversation."><PagedItems items={replay.measuredRuns} size={8}>{run => <div className="detail" key={`${run.sessionId}:${run.runId}`}><div className="row"><strong>{run.model || 'Unknown model'}</strong><Badge>{run.status || 'Unknown status'}</Badge></div><p className="monospace">{run.sessionId} / {run.runId}</p><p className="muted">{run.provider || 'Unknown provider'} · {run.source || 'No usage source'}</p><div className="row"><span>Input {number(run.usage.input)}</span><span>Output {number(run.usage.output)}</span><strong>Total {number(run.usage.total)}</strong></div></div>}</PagedItems></Panel>
    <Panel title="Estimator rules and limits" description="These rules are reported by the service for this replay."><PagedItems items={replay.assumptions} size={8}>{(assumption, index) => <p key={index}>{assumption}</p>}</PagedItems></Panel>
  </div>
}
