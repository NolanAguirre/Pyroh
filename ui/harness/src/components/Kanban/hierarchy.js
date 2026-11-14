export const createCardHierarchy = (boards) => {
  // Include archived cards and every board when finding parents and children.
  const cards = boards.flatMap((board) => board.boardColumnsByBoardId.nodes.flatMap((column) =>
    column.cardsByColumnId.nodes.map((card) => ({ ...card, boardId: board.id, boardTitle: board.title }))))
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const childrenById = new Map()
  for (const card of cards) {
    if (!card.parentId) continue
    if (!childrenById.has(card.parentId)) childrenById.set(card.parentId, [])
    childrenById.get(card.parentId).push(card)
  }
  const getCard = (id) => cardsById.get(id)
  const getChildren = (id) => childrenById.get(id) || []
  const getParents = (id) => getChildren(id).length ? [] : cards.filter((card) => card.id !== id && card.epic && !card.parentId)
  return { getCard, getChildren, getParents }
}
