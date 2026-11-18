import { useState } from 'react'
import { Badge, Panel, PagedItems } from '../common/Primitives.jsx'
import { number, shortId } from '../common/format.js'
import { Timeline } from './Timeline.jsx'
import { ReferenceList } from './SelectionDetails.jsx'

export const RemovalStage = ({ replay, model, selection, onSelect }) => {
  const [filter, setFilter] = useState('all')
  const ordered = replay.ordering.actions.filter(action => action.kind !== 'container')
  const decisions = ordered.filter(action => {
    const decision = action.kind === 'request' ? model.turnDispositions.get(action.id) : model.blockDispositions.get(action.id)
    return filter === 'all' || decision?.action === filter
  })
  const retained = ordered.filter(action => (action.kind === 'request' ? model.turnDispositions.get(action.id) : model.blockDispositions.get(action.id))?.action !== 'remove')
  const selectedDecision = selection?.kind === 'request' ? model.turnDispositions.get(selection.id) : model.blockDispositions.get(selection?.id)
  return <div className="column"><Panel title="Evidence-backed removal decisions" description="Every deletion keeps its stated reason and replacement references. Retained content may still be excluded from visible tokenization, such as hidden reasoning or context boundaries."><div className="row"><Badge tone="remove">{number(replay.removed.blocks)} removed blocks</Badge><Badge tone="remove">{number(replay.removed.turns)} removed requests</Badge><Badge tone="warning">{number(replay.removed.estimatedDelegationTurns.length)} delegation-only request estimates</Badge></div><p className="muted">Counts include all captured dispositions. The transformation below shows placed actions only. Unplaced work remains visible in source timelines.</p></Panel>
    <div className="split-view"><Panel title="Before: placed original actions" description="Select a removed card to follow the proof and retained replacements."><label className="field"><span className="field__label">Decision filter</span><select className="select" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All decisions</option><option value="remove">Removed only</option><option value="retain">Retained only</option></select></label><Timeline key={filter} actions={decisions} model={model} selection={selection} onSelect={onSelect} removals label="Removal decisions" /></Panel><Panel title="After: retained actions" description={`${number(retained.length)} placed actions survive. No replacement text is invented.`}><Timeline actions={retained} model={model} selection={selection} onSelect={onSelect} removals label="Retained actions" /></Panel></div>
    {selectedDecision && <Panel title="Selected transformation" description={selectedDecision.reason}><div className="comparison"><div className="detail"><Badge tone={selectedDecision.action === 'remove' ? 'remove' : 'retain'}>{selectedDecision.action}</Badge><p className="monospace">{selection.id}</p></div><span className="comparison__arrow" aria-hidden="true">→</span><div className="detail">{selectedDecision.action === 'remove' ? selectedDecision.dependencies?.length ? <ReferenceList ids={selectedDecision.dependencies} model={model} onSelect={onSelect} label="Retained replacement evidence" /> : <p>Removed with no replacement block listed.</p> : <p>Original content stays in the ordered replay.</p>}</div></div></Panel>}
    <details className="disclosure"><summary>Heuristic delegation-only removals ({number(replay.removed.estimatedDelegationTurns.length)})</summary><PagedItems items={replay.removed.estimatedDelegationTurns}>{item => <div className="detail" key={item.turnId}><button className="button button--quiet" onClick={() => onSelect({ kind: 'request', id: item.turnId })}>Inspect {shortId(item.turnId)}</button><p className="muted">Coordination and repeated findings classification is an estimate, not proof of semantic equivalence.</p></div>}</PagedItems></details>
  </div>
}
