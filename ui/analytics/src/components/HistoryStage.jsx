import { useState } from 'react'
import { Badge, EmptyState, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { number, shortId } from '../common/format.js'
import { TokenizerDetails } from './TokenizerDetails.jsx'
import { Timeline } from './Timeline.jsx'
import { groupContextActions } from './replayModel.js'

const historyActions = (ids, model) => ids.map(id => {
  const block = model.blocks.get(id)
  return { ...model.ordered.get(id), kind: 'block', id, sessionId: block?.sessionId, runId: block?.runId }
})

const HistoryBlocks = ({ ids, model, onSelect, selection, contributions }) => {
  return <Timeline actions={historyActions(ids, model)} model={model} onSelect={onSelect} selection={selection} contributions={contributions} label="Message and response context" />
}

const estimateLabels = { input: 'Input (includes cache)', cacheRead: 'Assumed cached input', fresh: 'Fresh input', output: 'Output' }

export const HistoryStage = ({ replay, model, selection, onSelect }) => {
  const [index, setIndex] = useState(0)
  const request = replay.replayTurns[index]
  const choose = next => {
    setIndex(next)
    onSelect({ kind: 'request', id: replay.replayTurns[next].turnId })
  }
  if (!request) return <EmptyState title="No surviving model calls">The replay has no retained model-call history to tokenize. Inspect removals and coverage for the available evidence.</EmptyState>
  const tokenizer = replay.tokenizer.identities.find(item => item.model === request.model)
  return <div className="column">
    <Panel title="Retained model-call history" description="Step through the fitted requests after removals and child insertion. Original usage and active-context measurements constrain grouping and content allocations. Inferred boundaries remain marked.">
      <div className="stage-controls"><button className="button" disabled={index === 0} onClick={() => choose(index - 1)}>Previous model call</button><label className="field"><span className="field__label">Model call {number(index + 1)} of {number(replay.replayTurns.length)}</span><input className="input" type="number" min="1" max={replay.replayTurns.length} value={index + 1} onChange={event => {
        const next = Number(event.target.value) - 1
        if (Number.isInteger(next) && next >= 0 && next < replay.replayTurns.length) choose(next)
      }} /></label><button className="button" disabled={index === replay.replayTurns.length - 1} onClick={() => choose(index + 1)}>Next model call</button></div>
      <input className="input" type="range" aria-label="Replay model-call position" min="0" max={Math.max(0, replay.replayTurns.length - 1)} value={index} onChange={event => choose(Number(event.target.value))} />
      <div className="row"><Badge tone={request.confidence === 'measured' ? 'neutral' : 'warning'}>{request.confidence} boundary</Badge><span className="monospace">{shortId(request.turnId)}</span><span>{request.originalModel} → {request.model}</span><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.turnId })}>Inspect model call</button></div>
      <div className="summary-grid"><Metric label="Context steps" value={number(groupContextActions(historyActions(request.requestBlockIds, model), model).length)} detail="Messages, response content, and tool results" /><Metric label="Fitted replay input" value={number(request.input.estimate)} detail="Includes cached and fresh input" /><Metric label="Assumed cached input" value={number(request.cacheRead?.estimate)} detail="Retained context previously sent" /><Metric label="Fresh input" value={number(request.fresh?.estimate)} detail="Content first sent in this request" /><Metric label="Fitted replay output" value={number(request.output.estimate)} detail={`${number(request.generatedBlockIds.length)} retained generated blocks`} /><Metric label="Context limit" value={number(request.contextLimit)} detail={request.contextLimitExceeded === true ? 'Exceeded by fitted input + output' : request.contextLimitExceeded === false ? 'Fitted input + output within limit' : 'Limit check unavailable'} /></div>
      {tokenizer && <TokenizerDetails identity={tokenizer} />}
      {request.fitting && <div className="row"><Badge tone={request.fitting.solverConverged === true ? 'neutral' : 'warning'}>{request.fitting.solverConverged === true ? 'Fit solver converged' : request.fitting.solverConverged === false ? 'Fit solver did not converge' : 'Fit solver status unavailable'}</Badge><span>Input source: {request.fitting.inputSource || 'Unknown'}</span><span>Original region: {number(request.fitting.originalRegion)}</span></div>}
      {request.cache && <div className="detail"><div className="row"><Badge tone={request.cache.status === 'estimated' ? 'neutral' : 'warning'}>Cache: {request.cache.status}</Badge>{request.cache.previousTurnId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.cache.previousTurnId })}>Previous input: {shortId(request.cache.previousTurnId)}</button>}</div>{request.cache.resetReason && <p className="muted">Cache reset: {request.cache.resetReason}</p>}<p className="muted">Cache use is assumed for this scenario, not measured provider cache usage.</p></div>}
      {request.contextLimitExceeded && <p className="alert alert--error">Fitted input and output exceed the recorded context limit. This scenario cannot establish that the same work would fit in one chat.</p>}
    </Panel>
    <div className="split-view"><Panel title="Before model call: retained context" description="Each captured prompt appears as one user message with expandable sections. Response content shares its known response identity. Tool results add context. Earlier output becomes input to later model calls."><HistoryBlocks key={`input:${request.turnId}`} ids={request.requestBlockIds} model={model} selection={selection} onSelect={onSelect} /></Panel><Panel title="Assistant response: generated output" description="Retained output is charged once. Measured output without captured content remains separately attributed."><HistoryBlocks key={`output:${request.turnId}`} ids={request.generatedBlockIds} model={model} selection={selection} onSelect={onSelect} contributions={request.outputAdjustment.outputContributions} /><p className="muted">Block contributions and unattributed output make up the fitted output estimate.</p></Panel></div>
    <Panel title="Input and output accounting" description="Original fitted usage supplies content allocations. Replay usage is recalculated after removals and child insertion."><div className="table-scroll"><table className="data-table"><caption>Selected model-call token accounting</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Original fitted usage</th><th scope="col">Replay tokens</th></tr></thead><tbody><tr><th scope="row">Input</th><td>{number(request.inputAdjustment.attributedOriginalInput)}</td><td>{number(request.inputAdjustment.cumulativeRequestInput)}</td></tr><tr><th scope="row">Output</th><td>{number(request.outputAdjustment.attributedOriginalOutput)}</td><td>{number(request.outputAdjustment.generatedOutput)}</td></tr></tbody></table></div><div className="summary-grid"><Metric label="Visible input before fitting" value={number(request.inputAdjustment.visibleInput)} /><Metric label="Input without captured content" value={number(request.inputAdjustment.opaqueInput)} /><Metric label="Output without captured content" value={number(request.outputAdjustment.opaqueOutput)} /></div><p className="muted">{request.inputAdjustment.basis}</p><p className="muted">{request.outputAdjustment.basis}</p><details className="disclosure"><summary>Earlier output included in this model call</summary><PagedItems items={request.requestOutputContributions} size={6}>{item => <button className="button button--quiet" key={item.blockId} onClick={() => onSelect({ kind: 'block', id: item.blockId })}>{shortId(item.blockId)} · {number(item.tokens)} output tokens</button>}</PagedItems></details></Panel>
    <Panel title="Automatic model-call estimate" description="Each surviving request counts its retained fitted context as input. Retained generated output is charged once, then joins later history at its recorded position.">
      <p className="muted">Retained context sent before is assumed cached. Newly introduced content, including previous generated output and tool results, is fresh on its first input appearance. Cached input is included in input, not added again.</p>
      <p className="muted">Compaction separates original context regions. Missing content and conflicting measurements remain explicit in the fit. Thinking and provider-dependent content are excluded from visible tokenization but may contribute to measured allocations.</p>
      <div className="table-scroll"><table className="data-table"><caption>Selected model-call estimates and bounds, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Point estimate</th><th scope="col">Lower bound</th><th scope="col">Upper bound</th></tr></thead><tbody>{Object.entries(estimateLabels).map(([field, label]) => {
        const range = request[field]
        return <tr key={field}><th scope="row">{label}</th><td>{number(range?.estimate)}</td><td>{number(range?.lower)}</td><td>{range?.upper == null ? 'Unknown / unbounded' : number(range.upper)}</td></tr>
      })}</tbody></table></div>
      <p className="alert alert--warning">{request.uncertainty}</p>
    </Panel>
  </div>
}
