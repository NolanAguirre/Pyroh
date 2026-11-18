import { useState } from 'react'
import { Badge, EmptyState, Metric, Panel, PagedItems } from '../common/Primitives.jsx'
import { number, preview, shortId } from '../common/format.js'
import { TokenizerDetails } from './TokenizerDetails.jsx'

const HistoryBlocks = ({ ids, model, onSelect, selection, contributions }) => {
  return <div className="request-history"><PagedItems items={ids} size={8} empty="No captured blocks in this context.">{id => {
    const block = model.blocks.get(id)
    const contribution = contributions?.find(item => item.blockId === id)
    return <button key={id} className={`request-history__block${selection?.id === id ? ' request-history__block--selected' : ''}`} aria-pressed={selection?.id === id} onClick={() => onSelect({ kind: 'block', id })}><span className="row"><strong>{block?.name || block?.kind || 'Missing block'}</strong>{contribution && <Badge>{number(contribution.tokens)} tokens</Badge>}</span><span className="timeline__meta">{shortId(block?.sessionId)} · {shortId(id)}</span><span className="timeline__preview">{preview(block?.content) || 'No visible text'}</span></button>
  }}</PagedItems></div>
}

export const HistoryStage = ({ replay, model, selection, onSelect }) => {
  const [index, setIndex] = useState(0)
  const request = replay.replayTurns[index]
  const choose = next => {
    setIndex(next)
    onSelect({ kind: 'request', id: replay.replayTurns[next].turnId })
  }
  if (!request) return <EmptyState title="No surviving requests">The replay has no retained request history to tokenize. Inspect removals and coverage for the available evidence.</EmptyState>
  const tokenizer = replay.tokenizer.identities.find(item => item.model === request.model)
  return <div className="column">
    <Panel title="Retained request history" description="Step through each surviving request. The API tokenizes the entire retained visible history at each request boundary.">
      <div className="stage-controls"><button className="button" disabled={index === 0} onClick={() => choose(index - 1)}>Previous request</button><label className="field"><span className="field__label">Request {number(index + 1)} of {number(replay.replayTurns.length)}</span><input className="input" type="number" min="1" max={replay.replayTurns.length} value={index + 1} onChange={event => {
        const next = Number(event.target.value) - 1
        if (Number.isInteger(next) && next >= 0 && next < replay.replayTurns.length) choose(next)
      }} /></label><button className="button" disabled={index === replay.replayTurns.length - 1} onClick={() => choose(index + 1)}>Next request</button></div>
      <input className="input" type="range" aria-label="Replay request position" min="0" max={Math.max(0, replay.replayTurns.length - 1)} value={index} onChange={event => choose(Number(event.target.value))} />
      <div className="row"><Badge tone={request.confidence === 'measured' ? 'neutral' : 'warning'}>{request.confidence} boundary</Badge><span className="monospace">{shortId(request.turnId)}</span><span>{request.originalModel} → {request.model}</span><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: request.turnId })}>Inspect request</button></div>
      <div className="summary-grid"><Metric label="History blocks" value={number(request.requestBlockIds.length)} detail="Visible context before generation" /><Metric label="Tokenized input" value={number(request.input.estimate)} detail="Entire retained history" /><Metric label="Tokenized output" value={number(request.output.estimate)} detail={`${number(request.generatedBlockIds.length)} generated blocks`} /><Metric label="Context limit" value={number(request.contextLimit)} detail={request.contextLimitExceeded === true ? 'Exceeded by visible input + output' : request.contextLimitExceeded === false ? 'Visible input + output within limit' : 'Limit check unavailable'} /></div>
      {tokenizer && <TokenizerDetails identity={tokenizer} />}
      {request.contextLimitExceeded && <p className="alert alert--error">Visible input and output exceed the recorded context limit. No synthetic compaction has been applied.</p>}
    </Panel>
    <div className="split-view"><Panel title="Before request: retained context" description="Messages enter once in transcript order. Earlier output becomes input to later requests."><HistoryBlocks key={`input:${request.turnId}`} ids={request.requestBlockIds} model={model} selection={selection} onSelect={onSelect} /></Panel><Panel title="After request: generated output" description="Only retained visible output is charged here, then added to later history."><HistoryBlocks key={`output:${request.turnId}`} ids={request.generatedBlockIds} model={model} selection={selection} onSelect={onSelect} contributions={request.outputAdjustment.outputContributions} /><p className="muted">Per-block token counts are diagnostic. The API’s whole-output count above is authoritative.</p></Panel></div>
    <Panel title="Input and output accounting" description="Original response usage is audit evidence. It is not deducted from or inserted into replay context."><div className="table-scroll"><table className="data-table"><caption>Selected request token accounting</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Original attributed usage</th><th scope="col">Replay tokens</th></tr></thead><tbody><tr><th scope="row">Input</th><td>{number(request.inputAdjustment.attributedOriginalInput)}</td><td>{number(request.inputAdjustment.cumulativeRequestInput)}</td></tr><tr><th scope="row">Output</th><td>{number(request.outputAdjustment.attributedOriginalOutput)}</td><td>{number(request.outputAdjustment.generatedOutput)}</td></tr></tbody></table></div><p className="muted">{request.inputAdjustment.basis}</p><p className="muted">{request.outputAdjustment.basis}</p><details className="disclosure"><summary>Earlier output included in this request</summary><PagedItems items={request.requestOutputContributions} size={6}>{item => <button className="button button--quiet" key={item.blockId} onClick={() => onSelect({ kind: 'block', id: item.blockId })}>{shortId(item.blockId)} · {number(item.tokens)} output tokens</button>}</PagedItems></details></Panel>
    <Panel title="Automatic request estimate" description="Each surviving request counts its complete retained visible history as input. Each retained generated block is charged once as output, then joins later history at its recorded position.">
      <p className="muted">Earlier content is counted again whenever a later request includes it. Removed requests add no input or output charge and do not clear history. Recorded resets and compaction do not create replacement summaries in this scenario.</p>
      <p className="muted">Thinking, provider-dependent blocks, and context boundaries are excluded from visible token counts. Calibration residuals do not adjust these estimates.</p>
      <div className="table-scroll"><table className="data-table"><caption>Selected request estimates and bounds, in tokens</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Point estimate</th><th scope="col">Lower bound</th><th scope="col">Upper bound</th></tr></thead><tbody>{['input', 'output'].map(field => <tr key={field}><th scope="row">{field === 'input' ? 'Input' : 'Output'}</th><td>{number(request[field].estimate)}</td><td>{number(request[field].lower)}</td><td>{request[field].upper === null ? 'Unknown / unbounded' : number(request[field].upper)}</td></tr>)}</tbody></table></div>
      <p className="alert alert--warning">{request.uncertainty}</p>
    </Panel>
  </div>
}
