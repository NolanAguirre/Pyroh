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
    <Panel title="Retained model-call history" description="Step through each surviving model call. The API tokenizes its entire retained visible history once. Calls with inferred boundaries are marked; missing calls are not invented.">
      <div className="stage-controls"><button className="button" disabled={index === 0} onClick={() => choose(index - 1)}>Previous model call</button><label className="field"><span className="field__label">Model call {number(index + 1)} of {number(replay.replayTurns.length)}</span><input className="input" type="number" min="1" max={replay.replayTurns.length} value={index + 1} onChange={event => {
        const next = Number(event.target.value) - 1
        if (Number.isInteger(next) && next >= 0 && next < replay.replayTurns.length) choose(next)
      }} /></label><button className="button" disabled={index === replay.replayTurns.length - 1} onClick={() => choose(index + 1)}>Next model call</button></div>
      <input className="input" type="range" aria-label="Replay model-call position" min="0" max={Math.max(0, replay.replayTurns.length - 1)} value={index} onChange={event => choose(Number(event.target.value))} />
      <div className="row"><Badge tone={request.confidence === 'measured' ? 'neutral' : 'warning'}>{request.confidence} boundary</Badge><span className="monospace">{shortId(request.turnId)}</span><span>{request.originalModel} → {request.model}</span><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.turnId })}>Inspect model call</button></div>
      <div className="summary-grid"><Metric label="Context steps" value={number(groupContextActions(historyActions(request.requestBlockIds, model), model).length)} detail="Messages, response content, and tool results" /><Metric label="Tokenized input" value={number(request.input.estimate)} detail="Entire retained history" /><Metric label="Tokenized output" value={number(request.output.estimate)} detail={`${number(request.generatedBlockIds.length)} generated blocks`} /><Metric label="Context limit" value={number(request.contextLimit)} detail={request.contextLimitExceeded === true ? 'Exceeded by visible input + output' : request.contextLimitExceeded === false ? 'Visible input + output within limit' : 'Limit check unavailable'} /></div>
      {tokenizer && <TokenizerDetails identity={tokenizer} />}
      {request.contextLimitExceeded && <p className="alert alert--error">Visible input and output exceed the recorded context limit. No synthetic compaction has been applied.</p>}
    </Panel>
    <div className="split-view"><Panel title="Before model call: retained context" description="Each captured prompt appears as one user message with expandable sections. Response content shares its known response identity. Tool results add context. Earlier output becomes input to later model calls."><HistoryBlocks key={`input:${request.turnId}`} ids={request.requestBlockIds} model={model} selection={selection} onSelect={onSelect} /></Panel><Panel title="Assistant response: generated output" description="Only retained visible output is charged here, then added to later history."><HistoryBlocks key={`output:${request.turnId}`} ids={request.generatedBlockIds} model={model} selection={selection} onSelect={onSelect} contributions={request.outputAdjustment.outputContributions} /><p className="muted">Per-block token counts are diagnostic. The API’s whole-output count above is authoritative.</p></Panel></div>
    <Panel title="Input and output accounting" description="Original response usage is audit evidence. It is not deducted from or inserted into replay context."><div className="table-scroll"><table className="data-table"><caption>Selected model-call token accounting</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Original attributed usage</th><th scope="col">Replay tokens</th></tr></thead><tbody><tr><th scope="row">Input</th><td>{number(request.inputAdjustment.attributedOriginalInput)}</td><td>{number(request.inputAdjustment.cumulativeRequestInput)}</td></tr><tr><th scope="row">Output</th><td>{number(request.outputAdjustment.attributedOriginalOutput)}</td><td>{number(request.outputAdjustment.generatedOutput)}</td></tr></tbody></table></div><p className="muted">{request.inputAdjustment.basis}</p><p className="muted">{request.outputAdjustment.basis}</p><details className="disclosure"><summary>Earlier output included in this model call</summary><PagedItems items={request.requestOutputContributions} size={6}>{item => <button className="button button--quiet" key={item.blockId} onClick={() => onSelect({ kind: 'block', id: item.blockId })}>{shortId(item.blockId)} · {number(item.tokens)} output tokens</button>}</PagedItems></details></Panel>
    <Panel title="Automatic model-call estimate" description="Each surviving model call counts its complete retained visible history as input. Each retained generated block is charged once as output, then joins later history at its recorded position.">
      <p className="muted">Earlier content is counted again whenever a later model call includes it. Removed model calls add no input or output charge and do not clear history. Recorded resets and compaction do not create replacement summaries in this scenario.</p>
      <p className="muted">Thinking, provider-dependent blocks, and context boundaries are excluded from visible token counts. Calibration residuals do not adjust these estimates.</p>
      <div className="table-scroll"><table className="data-table"><caption>Selected model-call estimates and bounds, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Point estimate</th><th scope="col">Lower bound</th><th scope="col">Upper bound</th></tr></thead><tbody>{['input', 'output'].map(field => <tr key={field}><th scope="row">{field === 'input' ? 'Input' : 'Output'}</th><td>{number(request[field].estimate)}</td><td>{number(request[field].lower)}</td><td>{request[field].upper === null ? 'Unknown / unbounded' : number(request[field].upper)}</td></tr>)}</tbody></table></div>
      <p className="alert alert--warning">{request.uncertainty}</p>
    </Panel>
  </div>
}
