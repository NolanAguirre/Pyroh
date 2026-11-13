import { client } from './client'

const USER_FIELDS = '__typename id name'
const CARD_FIELDS = `__typename id title description columnId archivedAt userByAuthorId { ${USER_FIELDS} }`
const COLUMN_FIELDS = `__typename id title cardsByColumnId(orderBy: [POSITION_ASC, ID_ASC]) { nodes { ${CARD_FIELDS} } }`
const BOARD_FIELDS = `__typename id title boardColumnsByBoardId(orderBy: [POSITION_ASC, ID_ASC]) { nodes { ${COLUMN_FIELDS} } }`
const REPLY_FIELDS = `__typename id body createdAt userByAuthorId { ${USER_FIELDS} }`
const COMMENT_FIELDS = `__typename id cardId body createdAt userByAuthorId { ${USER_FIELDS} }
  commentRepliesByCommentId(orderBy: [CREATED_AT_ASC, ID_ASC]) { nodes { ${REPLY_FIELDS} } }`

export const BOARDS_QUERY = `query Boards {
  allBoards(orderBy: [CREATED_AT_ASC, ID_ASC]) { nodes { ${BOARD_FIELDS} } }
}`
export const COMMENTS_QUERY = `query Comments($cardId: UUID!) {
  allCardComments(condition: { cardId: $cardId }, orderBy: [CREATED_AT_ASC, ID_ASC]) { nodes { ${COMMENT_FIELDS} } }
}`

export const mutate = async (field, type, input, selection, boardId) => {
  if (!selection) {
    const entity = type.includes('Column') ? 'boardColumn' : type.includes('Board') ? 'board' : 'card'
    const fields = field.startsWith('delete') ? '__typename id'
      : entity === 'board' ? BOARD_FIELDS : entity === 'boardColumn' ? COLUMN_FIELDS : CARD_FIELDS
    selection = `${entity} { ${fields} }`
  }
  // Returning the affected board's connections updates membership and ordering
  // in the same mutation response, including both columns when a card moves.
  return client.mutate({
    mutation: `mutation Change($input: ${type}!${boardId ? ', $boardId: UUID!' : ''}) {
      ${field}(input: $input) { __typename ${selection}
        ${boardId ? `query { __typename boardById(id: $boardId) { ${BOARD_FIELDS} } }` : ''}
      }
    }`,
    variables: { input, ...(boardId ? { boardId } : {}) },
  })
}
export const moveCard = (cardId, targetColumnId, beforeCardId, boardId) => mutate('moveCard', 'MoveCardInput',
  { cardId, targetColumnId, beforeCardId }, undefined, boardId)
export const archiveCard = (cardId, boardId) => mutate('archiveCard', 'ArchiveCardInput', { cardId }, undefined, boardId)
export const restoreCard = (cardId, boardId) => mutate('restoreCard', 'RestoreCardInput', { cardId }, undefined, boardId)
export const moveColumn = (columnId, beforeColumnId, boardId) => mutate('moveColumn', 'MoveColumnInput',
  { columnId, beforeColumnId }, undefined, boardId)
export const addComment = (cardId, body, authorId) => mutate('createCardComment', 'CreateCardCommentInput',
  { cardComment: { cardId, body, authorId } }, `cardComment { ${COMMENT_FIELDS} }`)
export const addReply = async (commentId, body, authorId) => client.mutate({
  mutation: `mutation AddReply($input: CreateCommentReplyInput!, $commentId: UUID!) {
    createCommentReply(input: $input) { __typename
      commentReply { ${REPLY_FIELDS} }
      query { __typename cardCommentById(id: $commentId) { ${COMMENT_FIELDS} } }
    }
  }`,
  variables: { input: { commentReply: { commentId, body, authorId } }, commentId },
})
export const saveCard = (card, title, description, columnId, authorId, boardId) => {
  if (!card.id) return mutate('createCard', 'CreateCardInput', { card: { title, description, columnId, authorId } }, undefined, boardId)
  return mutate('saveCardDetails', 'SaveCardDetailsInput', {
    cardId: card.id, cardTitle: title, cardDescription: description, targetColumnId: columnId,
  }, undefined, boardId)
}
export const signIn = (name) => mutate('signIn', 'SignInInput', { userName: name }, `user { ${USER_FIELDS} }`)
