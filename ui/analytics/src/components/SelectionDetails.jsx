import { Badge, EmptyState, EvidenceText, Panel, PagedItems } from '../common/Primitives.jsx'
import { blockLabel, number, shortId } from '../common/format.js'

export const ReferenceList = ({ ids = [], model, onSelect, label = 'Referenced blocks' }) => {
  return <div className="detail__references"><h4>{label} ({number(ids.length)})</h4><PagedItems items={ids} size={6}>{id => <button key={id} className="button button--quiet" onClick={() => onSelect({ kind: model.turns.has(id) ? 'request' : 'block', id })}>{model.blocks.has(id) ? blockLabel(model.blocks.get(id)) : 'Model call'} · {shortId(id)}</button>}</PagedItems></div>
}

const BlockDetails = ({ block, model, onSelect }) => {
  const decision = model.blockDispositions.get(block.id)
  const action = model.ordered.get(block.id)
  return <div className="column">
    <div className="row"><Badge>{blockLabel(block)}</Badge><Badge tone={decision?.action === 'remove' ? 'remove' : 'retain'}>{decision?.action || 'No decision'}</Badge>{block.fallback && <Badge tone="warning">Fallback capture</Badge>}</div>
    <dl className="key-value"><dt>Block</dt><dd className="monospace">{block.id}</dd><dt>Session</dt><dd className="monospace">{block.sessionId}</dd><dt>Run</dt><dd className="monospace">{block.runId}</dd><dt>Role / tool</dt><dd>{block.kind === 'prompt' ? 'user' : block.role || block.name || '—'}</dd><dt>Visibility</dt><dd>{block.visibility || 'Unspecified'}</dd><dt>Evidence position</dt><dd>{action ? number(action.index + 1) : 'Unplaced'}</dd><dt>Target model</dt><dd>{action?.targetModel || 'Unplaced'}</dd></dl>
    {decision && <div className="detail"><h4>Disposition reason</h4><p>{decision.reason}</p></div>}
    {decision?.action === 'remove' && !decision.dependencies?.length && <p className="muted">No replacement block is listed for this removal.</p>}
    {!!decision?.dependencies?.length && <ReferenceList ids={decision.dependencies} model={model} onSelect={onSelect} label={decision.action === 'remove' ? 'Retained replacements' : 'Dependencies'} />}
    {!!decision?.originalDependencies?.length && <ReferenceList ids={decision.originalDependencies} model={model} onSelect={onSelect} label="Original replacement chain" />}
    {block.turnId && <button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: block.turnId })}>Inspect generating assistant response</button>}
    {block.kind === 'prompt' && <div className="detail"><h4>Message provenance</h4><p>Provider role: user. Section kind: {block.sectionKind || 'Unclassified'}. Section labels describe content inside this message.</p>{block.messageId && <p className="monospace">Message: {block.messageId}</p>}{block.userItemId && <p className="monospace">User item: {block.userItemId}</p>}</div>}
    <EvidenceText value={block.content} />
    <EvidenceText value={block.sources || []} label="Source references" />
    <EvidenceText value={block} label="Complete selected block evidence" />
  </div>
}

const RequestDetails = ({ turn, estimate, model, onSelect }) => {
  const decision = model.turnDispositions.get(turn.id)
  const accounting = model.accounting.get(turn.id)
  return <div className="column">
    <div className="row"><Badge tone={turn.confidence === 'measured' ? 'neutral' : 'warning'}>{turn.confidence || 'Unknown'} boundary</Badge><Badge tone={decision?.action === 'remove' ? 'remove' : 'retain'}>{decision?.action || 'Unknown disposition'}</Badge>{estimate?.contextLimitExceeded && <Badge tone="warning">Context limit exceeded</Badge>}</div>
    <dl className="key-value"><dt>Model call</dt><dd className="monospace">{turn.id}</dd><dt>Session</dt><dd className="monospace">{turn.sessionId}</dd><dt>Original model</dt><dd>{turn.model || 'Unknown'}</dd><dt>Replay model</dt><dd>{estimate?.model || 'No replay model call'}</dd><dt>Original input</dt><dd>{number(accounting?.attributedOriginalInput ?? turn.measuredUsage?.inputTokens)}</dd><dt>Original output</dt><dd>{number(accounting?.attributedOriginalOutput ?? turn.measuredUsage?.outputTokens)}</dd><dt>Retained input</dt><dd>{number(accounting?.retainedEntryInput)}</dd><dt>Retained output</dt><dd>{number(accounting?.retainedOutput)}</dd><dt>Context limit</dt><dd>{number(estimate?.contextLimit)}</dd></dl>
    <div className="detail"><h4>Model-call decision</h4><p>{decision?.reason || 'No model-call disposition is available.'}</p>{accounting && <p className="muted">{accounting.basis}</p>}</div>
    {estimate && <><p className="alert alert--warning">{estimate.uncertainty}</p><dl className="key-value"><dt>Input range</dt><dd>{number(estimate.input.lower)} to {estimate.input.upper === null ? 'unknown upper bound' : number(estimate.input.upper)}</dd><dt>Output range</dt><dd>{number(estimate.output.lower)} to {estimate.output.upper === null ? 'unknown upper bound' : number(estimate.output.upper)}</dd><dt>Model-call input fingerprint</dt><dd className="monospace">{estimate.requestFingerprint}</dd></dl><ReferenceList ids={estimate.requestBlockIds} model={model} onSelect={onSelect} label="Retained history at this model call" /><ReferenceList ids={estimate.generatedBlockIds} model={model} onSelect={onSelect} label="Charged generated blocks" /><EvidenceText value={estimate} label="Complete replay model-call evidence" /></>}
    {!estimate && <ReferenceList ids={turn.blocks} model={model} onSelect={onSelect} label="Original generated blocks" />}
    <EvidenceText value={turn.sources || []} label="Model-call source references" />
    <EvidenceText value={turn} label="Original model-call evidence" />
  </div>
}

export const SelectionDetails = ({ selection, model, onSelect }) => {
  const block = selection?.kind === 'block' ? model.blocks.get(selection.id) : null
  const turn = selection?.kind === 'request' ? model.turns.get(selection.id) : null
  const action = selection?.kind === 'container' ? model.ordered.get(selection.id) : null
  return <Panel title="Selection details" description="Select any card to inspect the evidence and follow its references.">{block ? <BlockDetails key={block.id} block={block} model={model} onSelect={onSelect} /> : turn ? <RequestDetails key={turn.id} turn={turn} estimate={model.estimates.get(turn.id)} model={model} onSelect={onSelect} /> : action ? <EvidenceText value={action} label="Workflow anchor" /> : <EmptyState title={selection ? 'Evidence unavailable' : 'Nothing selected'}>{selection ? 'This reference has no captured detail in the replay.' : 'Choose a message, section, tool result, or assistant response.'}</EmptyState>}</Panel>
}
