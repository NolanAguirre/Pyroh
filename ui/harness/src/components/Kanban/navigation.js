const BOARD_PARAM = 'kanban-board'
const TASK_PARAM = 'kanban-task'
const MODE_PARAM = 'kanban-mode'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const readRoute = (url) => {
  const boardId = url.searchParams.get(BOARD_PARAM) || ''
  const taskId = url.searchParams.get(TASK_PARAM) || ''
  return {
    boardId,
    taskId,
    view: url.searchParams.get(MODE_PARAM) === 'matrix' ? 'matrix' : 'board',
    invalid: Boolean((boardId && !UUID.test(boardId)) || (taskId && (!boardId || !UUID.test(taskId)))),
  }
}

export const routeUrl = (url, { boardId, taskId = '', view = 'board' }) => {
  const next = new URL(url)
  next.searchParams.set('view', 'kanban')
  if (boardId) next.searchParams.set(BOARD_PARAM, boardId)
  else next.searchParams.delete(BOARD_PARAM)
  if (taskId) next.searchParams.set(TASK_PARAM, taskId)
  else next.searchParams.delete(TASK_PARAM)
  if (view === 'matrix') next.searchParams.set(MODE_PARAM, 'matrix')
  else next.searchParams.delete(MODE_PARAM)
  return next.href
}
