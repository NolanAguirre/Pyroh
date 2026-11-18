import { useState } from 'react'
import { Button, Fold, FoldContent, FoldTrigger, OrderDisplay } from 'component-library'
import CardRelationships from './CardRelationships'
import useCardDrag from './useCardDrag'

const activeCards = (column) => column.cardsByColumnId.nodes.filter((card) => !card.archivedAt)
const isEpicRow = (card) => card.epic && !card.parentId

const TaskCard = ({ card, hierarchy, busy, dragging, dropBefore, order, totalCount, onOpenCard, onArchive, onReorder, dragProps }) => {
  return <article className={`kanban__task-card${dragging ? ' kanban__dragging' : ''}${dropBefore ? ' kanban__drop-before' : ''}`} {...dragProps}>
    <button className="kanban__card-content" draggable={!busy} disabled={busy} onClick={() => onOpenCard(hierarchy.getCard(card.id).boardId, card)}><span>{card.title}</span>{card.description && <small>{card.description}</small>}<small>By {card.userByAuthorId?.name || 'Unknown author'}</small></button>
    <CardRelationships card={card} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} />
    <div className="kanban__card-footer"><span className="kanban__card-hint">Drag to move</span><span className="kanban__card-actions">
      <button className="kanban__icon-button" aria-label={`Archive ${card.title}`} disabled={busy} onClick={() => onArchive(card)}>Archive</button>
      <OrderDisplay id={card.id} order={order} totalCount={totalCount} updating={busy} move={onReorder} />
    </span></div>
  </article>
}

const KanbanRows = ({ board, hierarchy, busy, searching, matchesCard, onOpenCard, onNewCard, onEditColumn, onNewColumn, onMoveColumn, onArchive, onMoveCard, onMoveTask, onMoveEpic }) => {
  const [collapsedIds, setCollapsedIds] = useState([])
  const [dropTarget, setDropTarget] = useState(null)
  const { dragged, dragRef, clearDrag, getDragProps } = useCardDrag(busy, () => setDropTarget(null))
  const columns = board.boardColumnsByBoardId.nodes
  const cards = columns.flatMap(activeCards)
  const rowIds = new Set(cards.flatMap((card) => isEpicRow(card) ? [card.id] : card.parentId ? [card.parentId] : []))
  const rowOrder = new Map((board.epicRowsByBoardId?.nodes || []).map((row, index) => [row.epicId, index]))
  const epics = [...rowIds].map((id) => hierarchy.getCard(id)).filter(Boolean).sort((a, b) =>
    (rowOrder.get(a.id) ?? Infinity) - (rowOrder.get(b.id) ?? Infinity) || a.id.localeCompare(b.id))
  const rows = [...epics.filter((epic) => !searching || matchesCard(epic) || cards.some((card) => card.parentId === epic.id && matchesCard(card))), null]
  const collapsed = (column) => !searching && collapsedIds.includes(column.id)
  const toggleColumn = (id) => setCollapsedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const dragOver = (event, target, kind) => {
    const dragged = dragRef.current
    if (!dragged || busy || (kind && dragged.kind !== kind)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }
  const dropTask = (event, columnId, parentId, beforeCardId = null) => {
    event.preventDefault()
    event.stopPropagation()
    const dragged = dragRef.current
    if (dragged?.kind === 'task' && !busy && dragged.id !== beforeCardId) {
      const becomesEpicRow = !parentId && hierarchy.getCard(dragged.id).epic
      onMoveTask(dragged.id, columnId, parentId, becomesEpicRow ? null : beforeCardId)
    }
    clearDrag()
  }
  const dropEpic = (event, beforeEpicId = null) => {
    event.preventDefault()
    event.stopPropagation()
    const dragged = dragRef.current
    if (dragged?.kind === 'epic' && !busy && dragged.id !== beforeEpicId) onMoveEpic(dragged.id, beforeEpicId)
    clearDrag()
  }
  const dropStatus = (event, columnId) => {
    event.preventDefault()
    event.stopPropagation()
    const card = hierarchy.getCard(dragRef.current?.id)
    if (card && !busy && card.boardId === board.id && !card.archivedAt && card.columnId !== columnId) onMoveCard(card.id, columnId, null)
    clearDrag()
  }
  const reorderEpic = (id, direction) => {
    const index = epics.findIndex((epic) => epic.id === id)
    onMoveEpic(id, epics[index + (direction === 'up' ? -1 : 2)]?.id || null)
  }
  return <div className="kanban__board-canvas kanban__board-canvas--rows" aria-busy={busy}>
    <table className="kanban__epic-table" aria-label={`${board.title}: epics and tasks by status`}>
      <thead><tr>
        <th scope="col" className="kanban__epic-heading"><span>Epics / tasks</span><Button variant="ghost" size="sm" disabled={busy || !columns.length} onClick={() => onNewCard({ columnId: columns[0]?.id, epic: true })}>+ Add epic</Button></th>
        {columns.map((column, index) => <th scope="col" key={column.id} className={`kanban__status-heading${collapsed(column) ? ' kanban__status-heading--collapsed' : ''}${dropTarget === column.id ? ' kanban__drop-target' : ''}`} onDragOver={(event) => dragOver(event, column.id)} onDrop={(event) => dropStatus(event, column.id)}>
          {collapsed(column) ? <button className="kanban__column-collapsed" disabled={busy} aria-label={`Expand ${column.title}`} aria-expanded="false" onClick={() => toggleColumn(column.id)}>→</button> : <>
            <div className="kanban__column-heading"><h2>{column.title} <span>{activeCards(column).filter(matchesCard).length}</span></h2><button className="kanban__icon-button" disabled={busy} aria-label={`Edit ${column.title}`} onClick={() => onEditColumn(column)}>•••</button><button className="kanban__icon-button" disabled={busy} aria-label={`Collapse ${column.title}`} aria-expanded="true" onClick={() => toggleColumn(column.id)}>←</button></div>
            <div className="kanban__column-order"><button disabled={busy || index === 0} aria-label={`Move ${column.title} left`} onClick={() => onMoveColumn(column.id, columns[index - 1].id)}>←</button><button disabled={busy || index === columns.length - 1} aria-label={`Move ${column.title} right`} onClick={() => onMoveColumn(column.id, columns[index + 2]?.id || null)}>→</button></div>
          </>}
        </th>)}
      </tr></thead>
      <tbody>{rows.map((epic) => {
        const rowKey = epic?.id || 'standalone'
        return <tr key={rowKey}>
          <th scope="row" className={`kanban__epic-heading${dropTarget === `row:${rowKey}` ? ' kanban__drop-before' : ''}`} onDragOver={(event) => dragOver(event, `row:${rowKey}`, 'epic')} onDrop={(event) => dropEpic(event, epic?.id || null)}>
            {epic ? <div className={`kanban__task-card kanban__epic-card${dragged?.id === epic.id ? ' kanban__dragging' : ''}`} {...getDragProps({ id: epic.id, kind: 'epic' })}>
              <button className="kanban__card-content" draggable={!busy} disabled={busy} onClick={() => onOpenCard(epic.boardId, epic)}><small>Epic{epic.boardId !== board.id ? ` · ${epic.boardTitle}` : ''}{epic.archivedAt ? ' · Archived' : ''}</small><span>{epic.title}</span>{epic.description && <small>{epic.description}</small>}</button>
              {epic.boardId === board.id && !epic.archivedAt && <label className="kanban__epic-status">Status<select aria-label={`Status of ${epic.title}`} value={epic.columnId} disabled={busy} onChange={(event) => onMoveCard(epic.id, event.target.value, null)}>{columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}</select></label>}
              <CardRelationships card={epic} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} />
              <div className="kanban__card-footer"><span className="kanban__card-hint">Drag to order epics</span><span className="kanban__card-actions">{epic.boardId === board.id && <button className="kanban__icon-button" disabled={busy} aria-label={`${epic.archivedAt ? 'Restore' : 'Archive'} ${epic.title}`} onClick={() => onArchive(epic)}>{epic.archivedAt ? 'Restore' : 'Archive'}</button>}<OrderDisplay id={epic.id} order={epics.findIndex((item) => item.id === epic.id) + 1} totalCount={epics.length} updating={busy} move={reorderEpic} /></span></div>
            </div> : <span>Standalone tasks</span>}
          </th>
          {columns.map((column) => {
            const cellKey = `${rowKey}:${column.id}`
            const cellCards = activeCards(column).filter((card) => !isEpicRow(card) && (card.parentId || null) === (epic?.id || null))
            const visibleCards = cellCards.filter((card) => matchesCard(card) || (epic && matchesCard(epic)))
            return <td key={column.id} className={`kanban__epic-cell${collapsed(column) ? ' kanban__epic-cell--collapsed' : ''}${dropTarget === cellKey ? ' kanban__drop-target' : ''}`} onDragOver={(event) => dragOver(event, cellKey, 'task')} onDrop={(event) => dropTask(event, column.id, epic?.id || null)}>
              {collapsed(column) ? <span className="kanban__cell-count">{visibleCards.length || ''}</span> : <>
                <div className="kanban__cards">
                  {visibleCards.map((card) => <TaskCard key={card.id} card={card} hierarchy={hierarchy} busy={busy} dragging={dragged?.id === card.id} dropBefore={dropTarget === card.id} order={cellCards.findIndex((item) => item.id === card.id) + 1} totalCount={cellCards.length} onOpenCard={onOpenCard} onArchive={onArchive} onReorder={(id, direction) => {
                    const index = cellCards.findIndex((item) => item.id === id)
                    onMoveTask(id, column.id, epic?.id || null, cellCards[index + (direction === 'up' ? -1 : 2)]?.id || null)
                  }} dragProps={{ ...getDragProps({ id: card.id, kind: 'task' }), onDragOver: (event) => dragOver(event, card.id, 'task'), onDrop: (event) => dropTask(event, column.id, epic?.id || null, card.id) }} />)}
                  {!visibleCards.length && <div className="kanban__empty-column">{searching ? 'No matching tasks' : 'Drop a task here'}</div>}
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => onNewCard({ columnId: column.id, parentId: epic?.id || null })}>+ Add task</Button>
              </>}
            </td>
          })}
        </tr>
      })}</tbody>
      <tfoot><tr><th scope="row" className="kanban__epic-heading">Archived</th>{columns.map((column) => {
        const archived = column.cardsByColumnId.nodes.filter((card) => card.archivedAt && matchesCard(card)).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
        return <td key={column.id} className={`kanban__epic-cell${collapsed(column) ? ' kanban__epic-cell--collapsed' : ''}`}>
          {collapsed(column) ? <span className="kanban__cell-count">{archived.length || ''}</span> : archived.length > 0 && <Fold><FoldTrigger>Archived {archived.length}</FoldTrigger><FoldContent><ul className="kanban__archived-cards">{archived.map((card) => <li key={card.id}><div className="kanban__archived-details"><button className="kanban__archived-title" disabled={busy} onClick={() => onOpenCard(board.id, card)}>{card.title}</button><CardRelationships card={card} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} /></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => onArchive(card)} aria-label={`Restore ${card.title}`}>Restore</Button></li>)}</ul></FoldContent></Fold>}
        </td>
      })}</tr></tfoot>
    </table>
    <Button variant="secondary" disabled={busy} onClick={onNewColumn}>+ Add column</Button>
  </div>
}

export default KanbanRows
