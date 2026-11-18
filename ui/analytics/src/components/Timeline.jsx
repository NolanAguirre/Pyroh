import { useState } from 'react'
import { Badge, EvidenceText, Pager } from '../common/Primitives.jsx'
import { blockLabel, number, preview, shortId } from '../common/format.js'
import { groupContextActions } from './replayModel.js'

export const Timeline = ({ actions, model, selection, onSelect, joined = false, removals = false, contributions, label = 'Timeline' }) => {
  const [query, setQuery] = useState('')
  const [requestedPage, setPage] = useState(0)
  const term = query.trim().toLowerCase()
  const groups = groupContextActions(actions, model)
  const filtered = term ? groups.filter(group => `${group.kind} ${group.turn?.model || ''} ${group.actions.map(action => `${action.id} ${action.sessionId}`).join(' ')} ${group.blocks.map(block => `${blockLabel(block)} ${block.sectionKind || ''} ${preview(block.content, 300)}`).join(' ')}`.toLowerCase().includes(term)) : groups
  const size = 12
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / size) - 1))
  const unplaced = actions.length > 0 && !model.ordered.has(actions[0].id)
  const decisionFor = action => action.kind === 'request' ? model.turnDispositions.get(action.id) : model.blockDispositions.get(action.id)
  return <div className="column">
    {unplaced && <p className="alert alert--warning">Unplaced evidence follows recorded event positions within each run. No join position is inferred here.</p>}
    <p className="muted">Numbers mark conversation/context steps. Only assistant response boundaries represent model calls. Tool results add context.</p>
    <label className="field"><span className="field__label">Search {label.toLowerCase()}</span><input className="input" type="search" placeholder="ID, kind, tool, or text excerpt" value={query} onChange={event => {
      setQuery(event.target.value)
      setPage(0)
    }} /></label>
    <div className="timeline" aria-label={label}>{filtered.slice(page * size, (page + 1) * size).map(group => {
      const first = group.actions[0]
      const boundary = group.actions.find(action => action.kind === 'request')
      const target = boundary || first
      const selected = group.actions.some(action => action.id === selection?.id)
      const decisions = group.actions.map(decisionFor).filter(Boolean)
      const removed = removals && decisions.length === group.actions.length && decisions.every(item => item.action === 'remove')
      const disposition = decisions.some(item => item.action === 'remove') ? removed ? 'remove' : 'mixed' : 'retain'
      const depth = first.ancestry?.length || 0
      const children = joined ? group.actions.flatMap(action => model.insertions.get(action.id) || []) : []
      const title = group.kind === 'prompt' ? 'User message' : group.kind === 'response' ? 'Assistant response'
        : group.blocks.length ? blockLabel(group.blocks[0]) : 'Workflow anchor'
      const expandable = group.kind === 'prompt' || group.kind === 'response'
      return <div key={group.id} className="timeline__branch" style={joined ? { marginInlineStart: `${Math.min(depth, 3) * 0.65}rem` } : undefined}>
        <button className={`timeline__item${selected ? ' timeline__item--selected' : ''}${removed ? ' timeline__item--removed' : ''}`} aria-pressed={selected} onClick={() => onSelect({ kind: target.kind, id: target.id })}>
          <span className="timeline__marker">{number(group.step)}</span><span className="timeline__content">
            <span className="timeline__title"><strong>{title}{group.continued ? ' (continued)' : ''}</strong>{group.turn && <Badge tone={group.turn.confidence === 'measured' ? 'neutral' : 'warning'}>{group.turn.confidence || 'Unknown'} boundary</Badge>}{boundary && <Badge>Model call</Badge>}{removals && decisions.length > 0 && <Badge tone={removed ? 'remove' : disposition === 'mixed' ? 'warning' : 'retain'}>{disposition}</Badge>}</span>
            <span className="timeline__meta">{shortId(first.sessionId)} · {group.turn?.model || shortId(first.runId)}{joined && ` · depth ${depth}`}</span>
            <span className="timeline__preview">{preview(group.content) || (group.turn ? 'No captured response content at this step' : group.blocks[0]?.boundary || 'No visible text')}</span>
            {group.kind === 'prompt' && <span className="timeline__meta">{number(group.blocks.length)} sections in one user message</span>}
            {joined && <span className="timeline__meta">Target model: {first.targetModel}</span>}
          </span>
        </button>
        {expandable && <details className="disclosure timeline__sections" key={`${group.id}:${selected}`} open={selected || undefined}>
          <summary>{group.kind === 'prompt' ? 'Prompt sections and message text' : 'Response text, tool calls, and evidence'}</summary>
          <div className="column">{group.actions.map(action => {
            const block = model.blocks.get(action.id)
            const decision = decisionFor(action)
            const contribution = contributions?.find(item => item.blockId === action.id)
            return <button key={action.id} className={`timeline__item${selection?.id === action.id ? ' timeline__item--selected' : ''}${removals && decision?.action === 'remove' ? ' timeline__item--removed' : ''}`} aria-pressed={selection?.id === action.id} onClick={() => onSelect({ kind: action.kind, id: action.id })}>
              <span className="timeline__content"><span className="timeline__title"><strong>{block ? blockLabel(block) : 'Model call boundary'}</strong>{block?.sectionKind && <Badge>{block.sectionKind} section</Badge>}{removals && decision && <Badge tone={decision.action === 'remove' ? 'remove' : 'retain'}>{decision.action}</Badge>}{contribution && <Badge>{number(contribution.tokens)} tokens</Badge>}</span><span className="timeline__meta">{shortId(action.id)}{Number.isFinite(action.index) && ` · evidence position ${number(action.index + 1)}`}</span><span className="timeline__preview">{block ? preview(block.content) || 'No visible text' : group.turn?.reason}</span></span>
            </button>
          })}</div>
          <EvidenceText value={group.content} label={group.kind === 'prompt' ? 'Message text (sections joined exactly)' : 'Captured response content'} />
        </details>}
        {children.length > 0 && <div className="timeline__join">Join {number(children.length)} child session{children.length === 1 ? '' : 's'} here · {children.some(child => child.inferred) ? 'includes inferred anchor' : 'captured anchor'}</div>}
      </div>
    })}</div>
    {!filtered.length && <p className="muted">{actions.length ? 'No entries match this search.' : 'No captured context in this view.'}</p>}
    <Pager page={page} count={filtered.length} size={size} onChange={setPage} />
  </div>
}
