import { useState } from 'react'
import { Badge, Pager } from '../common/Primitives.jsx'
import { number, preview, shortId } from '../common/format.js'

export const Timeline = ({ actions, model, selection, onSelect, joined = false, removals = false, label = 'Timeline' }) => {
  const [query, setQuery] = useState('')
  const [requestedPage, setPage] = useState(0)
  const term = query.trim().toLowerCase()
  const filtered = term ? actions.filter(action => {
    const block = model.blocks.get(action.id)
    const turn = model.turns.get(action.id)
    return `${action.id} ${action.sessionId} ${block?.kind || ''} ${block?.name || ''} ${turn?.model || ''} ${preview(block?.content, 300)}`.toLowerCase().includes(term)
  }) : actions
  const size = 12
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / size) - 1))
  const unplaced = actions.length > 0 && !model.ordered.has(actions[0].id)
  return <div className="column">{unplaced && <p className="alert alert--warning">Unplaced evidence: run order follows the replay’s evidence list. Within each run, cards use recorded event positions. No join position is inferred here.</p>}<label className="field"><span className="field__label">Search {label.toLowerCase()}</span><input className="input" type="search" placeholder="ID, kind, tool, or text excerpt" value={query} onChange={event => { setQuery(event.target.value)
    setPage(0) }} /></label><div className="timeline" aria-label={label}>{filtered.slice(page * size, (page + 1) * size).map(action => {
    const block = model.blocks.get(action.id)
    const turn = model.turns.get(action.id)
    const disposition = action.kind === 'request' ? model.turnDispositions.get(action.id) : model.blockDispositions.get(action.id)
    const children = joined ? model.insertions.get(action.id) || [] : []
    const removed = removals && disposition?.action === 'remove'
    const depth = action.ancestry?.length || 0
    return <div key={action.id} className="timeline__branch" style={joined ? { marginInlineStart: `${Math.min(depth, 3) * 0.65}rem` } : undefined}><button className={`timeline__item${selection?.id === action.id ? ' timeline__item--selected' : ''}${removed ? ' timeline__item--removed' : ''}`} aria-pressed={selection?.id === action.id} onClick={() => onSelect({ kind: action.kind, id: action.id })}><span className="timeline__marker">{joined ? number(action.index + 1) : action.kind === 'request' ? 'R' : action.kind === 'container' ? 'W' : 'B'}</span><span className="timeline__content"><span className="timeline__title"><strong>{action.kind === 'request' ? 'Request boundary' : block?.name || block?.kind || 'Workflow anchor'}</strong>{turn && <Badge tone={turn.confidence === 'measured' ? 'neutral' : 'warning'}>{turn.confidence || 'Unknown'}</Badge>}{removals && disposition && <Badge tone={removed ? 'remove' : 'retain'}>{disposition.action}</Badge>}</span><span className="timeline__meta">{shortId(action.sessionId)} · {action.kind === 'request' ? turn?.model || 'Unknown model' : shortId(action.runId)}{joined && ` · depth ${depth}`}</span><span className="timeline__preview">{block ? preview(block.content) || block.boundary || 'No visible text' : turn ? `${number(turn.blocks?.length)} captured generated blocks` : 'Recorded workflow insertion point'}</span>{joined && <span className="timeline__meta">Target model: {action.targetModel}</span>}</span></button>{children.length > 0 && <div className="timeline__join">Join {number(children.length)} child session{children.length === 1 ? '' : 's'} here · {children.some(child => child.inferred) ? 'includes inferred anchor' : 'captured anchor'}</div>}</div>
  })}</div>{!filtered.length && <p className="muted">{actions.length ? 'No entries match this search.' : 'No captured actions in this view.'}</p>}<Pager page={page} count={filtered.length} size={size} onChange={setPage} /></div>
}
