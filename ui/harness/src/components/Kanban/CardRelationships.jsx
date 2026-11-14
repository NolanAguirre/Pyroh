const CardRelationships = ({ card, hierarchy, busy, onOpenCard, expanded = false }) => {
  const parent = hierarchy.getCard(card.parentId)
  const children = hierarchy.getChildren(card.id)
  const archivedCount = children.filter((child) => child.archivedAt).length
  if (!card.parentId && !children.length) return null
  const openCard = (item) => onOpenCard(item.boardId, item)
  return (
    <div className={`kanban__relationships${expanded ? ' kanban__relationships--expanded' : ''}`}>
      {parent ? <button type="button" className="kanban__relationship-link" disabled={busy} onClick={() => openCard(parent)}>Parent: {parent.title}{parent.archivedAt ? ' · Archived' : ''}</button>
        : card.parentId && <span>Parent unavailable</span>}
      {children.length > 0 && <>
        {expanded ? <h3>Epic · {children.length} {children.length === 1 ? 'child' : 'children'}{archivedCount > 0 && ` · ${archivedCount} archived`}</h3>
          : <button type="button" className="kanban__relationship-link" disabled={busy} onClick={() => openCard(hierarchy.getCard(card.id))}>Epic · {children.length} {children.length === 1 ? 'child' : 'children'}{archivedCount > 0 && ` · ${archivedCount} archived`}</button>}
        {expanded && <ul className="kanban__relationship-list">
          {children.map((child) => <li key={child.id}><button type="button" className="kanban__relationship-link" disabled={busy} onClick={() => openCard(child)}>{child.title}{child.boardId !== card.boardId && ` · ${child.boardTitle}`}{child.archivedAt ? ' · Archived' : ''}</button></li>)}
        </ul>}
      </>}
    </div>
  )
}

export default CardRelationships
