import { useEffect, useState } from 'react'
import { Button } from 'component-library'
import { getOrCreateBoard } from './api'
import KanbanBoard from './KanbanBoard'

const WorkspaceBoard = ({ workspace, ...props }) => {
  const [boardId, setBoardId] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { id, name } = workspace

  useEffect(() => {
    let active = true
    setBoardId('')
    setError('')
    getOrCreateBoard(id, name).then((result) => {
      const board = result.getOrCreateBoard?.board
      if (!board?.id || board.externalId !== id) throw new Error('The workspace board could not be loaded.')
      if (active) setBoardId(board.id)
    }).catch((failure) => {
      if (active) setError(failure.message)
    })
    return () => { active = false }
  }, [id, name, attempt])

  if (error) return <div className="kanban__error-banner" role="alert">{error}<Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button></div>
  if (!boardId) return <p className="kanban__loading" role="status">Loading workspace board…</p>
  return <KanbanBoard key={boardId} {...props} scopedBoardId={boardId} workspaceId={id} workspace={workspace} />
}

export default WorkspaceBoard
