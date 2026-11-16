import { Children, useEffect, useMemo, useRef, useState } from 'react'
import { readRoute, routeUrl } from './navigation'
import { BOARDS_QUERY, archiveCard, mutate, moveCard, moveColumn, moveTask, moveEpicRow, restoreCard, saveCard } from './api'
import TaskComments from './TaskComments'
import CardRelationships from './CardRelationships'
import { createCardHierarchy } from './hierarchy'
import { Button, PopupDisplay, Matrix, FormInput, DevScope, Fold, FoldTrigger, FoldContent, SplitPane, useBrowserLocation } from 'component-library'
import KanbanQuery from './KanbanQuery'
import KanbanRows from './KanbanRows'



const Editor = ({ devId, user, editor, boards, hierarchy, busy, error, onSave, onDelete, onArchive, onOpenCard, onCommentChange, popup }) => {
  const [title, setTitle] = useState(editor.item.title || '')
  const [description, setDescription] = useState(editor.item.description || '')
  const [boardId, setBoardId] = useState(editor.boardId || '')
  const [columnId, setColumnId] = useState(editor.item.columnId || '')
  const [parentId, setParentId] = useState(editor.item.parentId || '')
  const [epic, setEpic] = useState(Boolean(editor.item.epic))
  const columns = boards.find((board) => board.id === boardId)?.boardColumnsByBoardId.nodes || []
  const validColumn = editor.kind !== 'card' || columns.some((column) => column.id === columnId)
  const children = hierarchy.getChildren(editor.item.id)
  const epicLocked = children.length > 0
  const parents = hierarchy.getParents(editor.item.id)
  const unavailableParent = parentId && !parents.some((card) => card.id === parentId)
  const noun = editor.kind === 'boardColumn' ? 'column' : editor.kind
  return (
    <DevScope id={devId} state={{ mode: editor.kind, item: editor.item.id || undefined, busy: busy || undefined }}>
    <div role="dialog" aria-modal="true" aria-label={`${editor.item.id ? 'Edit' : 'New'} ${noun}`}>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (title.trim() && validColumn) onSave({ title: title.trim(), description, columnId, parentId: parentId || null, epic: epicLocked || epic })
    }}>
      {editor.kind !== 'card' && <h2>{editor.item.id ? `Edit ${noun}` : `New ${noun}`}</h2>}
      <fieldset disabled={busy}>
        <label className={editor.kind === 'card' ? 'kanban__editor-title' : undefined}>Title<DevScope id="ox3tq2n"><input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></DevScope></label>
        {editor.kind === 'card' && <>
          <DevScope id="dw8r404"><label>Description<textarea rows={7} maxLength={20000} placeholder="Add a little more detail…" value={description} onChange={(event) => setDescription(event.target.value)} /></label></DevScope>
          <div className="kanban__advanced">
            <Fold>
              <FoldTrigger>Advanced</FoldTrigger>
              <FoldContent>
                <div className="kanban__advanced-field">
                  <label className="kanban__editor-epic">Epic<input type="checkbox" checked={epicLocked || epic} disabled={epicLocked} onChange={(event) => setEpic(event.target.checked)} aria-describedby="kanban-epic-help" /></label>
                  <p id="kanban-epic-help" className="kanban__advanced-hint">Only epics appear when nesting a task under a parent.</p>
                </div>
                <div className="kanban__advanced-field">
                  <label>Parent task<select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-describedby="kanban-parent-help">
                    <option value="">No parent (root task)</option>
                    {unavailableParent && <option value={parentId} disabled>Current parent cannot be kept — remove it</option>}
                    {parents.map((card) => <option key={card.id} value={card.id}>{card.title} · {card.boardTitle}{card.archivedAt ? ' · Archived' : ''}</option>)}
                  </select></label>
                  <p id="kanban-parent-help" className="kanban__advanced-hint">{children.length
                    ? 'This task has children. Remove or reassign them, including archived children, before choosing a parent.'
                    : 'Choose an epic to nest this task under it. Choose No parent to remove the relationship.'}</p>
                </div>
                <div className="kanban__advanced-pair">
                  <label>Board<select value={boardId} onChange={(event) => {
                    const destinationId = event.target.value
                    const destinationColumns = boards.find((board) => board.id === destinationId)?.boardColumnsByBoardId.nodes || []
                    setBoardId(destinationId)
                    setColumnId(destinationColumns[0]?.id || '')
                  }}>
                    {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
                  </select></label>
                  <label>Column<DevScope id="ntbho75"><select required disabled={!columns.length} value={validColumn ? columnId : ''} onChange={(event) => setColumnId(event.target.value)}>
                    {!validColumn && <option value="">{columns.length ? 'Choose a column' : 'No columns available'}</option>}
                    {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
                  </select></DevScope></label>
                </div>
                {!columns.length && <p className="kanban__advanced-hint" role="status">This board has no columns. Add a column to it or choose another board before saving.</p>}
              </FoldContent>
            </Fold>
          </div>
          {editor.item.id && <CardRelationships card={hierarchy.getCard(editor.item.id) || editor.item} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} expanded />}
        </>}
        {error && <p role="alert" className="kanban__error">{error}</p>}
        <div className="kanban__editor-actions">
          {editor.item.id && <Button type="button" variant="danger" size="sm" onClick={onDelete} devId="ce03obf">Delete {noun}</Button>}
          {editor.kind === 'card' && editor.item.id && <Button type="button" variant="secondary" size="sm" onClick={onArchive} devId="ilzmmz9">{editor.item.archivedAt ? 'Restore card' : 'Archive card'}</Button>}
          <span />
          <Button type="button" variant="secondary" size="sm" onClick={popup.close} devId="43vqubf">Cancel</Button>
          <Button type="submit" size="sm" disabled={!title.trim() || !validColumn} devId="wd0pmd7">{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </fieldset>
    </form>
    {editor.kind === 'card' && (editor.item.id
      ? <TaskComments devId="d6klsew" user={user} cardId={editor.item.id} busy={busy} onChange={onCommentChange} />
      : <p className="kanban__comments-empty">Save this card to add comments.</p>)}
    {editor.kind === 'card' && editor.item.id && <p className="kanban__comments-empty kanban__created">Created by {editor.item.userByAuthorId?.name || 'Unknown author'}{editor.item.archivedAt && ' · Archived'}</p>}
    </div>
    </DevScope>
  )
}
const rememberedBoard = () => {
  try { return localStorage.getItem('kanban-board') || '' } catch { return '' }
}
// Columns load every card; ordering only applies to the active ones.
const activeCards = (column) => column.cardsByColumnId.nodes.filter((card) => !card.archivedAt)
const columnKey = (column) => column.title.trim().toLowerCase()

const ProjectMatrix = ({ devId, boards, hierarchy, busy, matchesCard, searching, onSelectBoard, onOpenCard, onMoveCard }) => {
  const [draggedId, setDragged] = useState(null)
  const draggedBoard = boards.find((board) => board.boardColumnsByBoardId.nodes.some((column) => activeCards(column).some((card) => card.id === draggedId)))
  const draggedCard = draggedBoard?.boardColumnsByBoardId.nodes.flatMap(activeCards).find((card) => card.id === draggedId)
  const dragged = draggedCard ? { cardId: draggedId, boardId: draggedBoard.id, columnId: draggedCard.columnId } : null
  const [dropTarget, setDropTarget] = useState(null)
  const suppressClick = useRef(false)
  const columns = []
  const seen = new Set()
  for (const board of boards) {
    const boardColumns = board.boardColumnsByBoardId.nodes
    for (const [index, column] of boardColumns.entries()) {
      const id = columnKey(column)
      if (seen.has(id)) continue
      // Insert custom stages before the next shared stage when possible.
      const next = boardColumns.slice(index + 1).find((item) => seen.has(columnKey(item)))
      const position = next ? columns.findIndex((item) => item.id === columnKey(next)) : columns.length
      columns.splice(position, 0, { id, title: column.title })
      seen.add(id)
    }
  }
  const rows = searching ? boards.filter((project) => project.boardColumnsByBoardId.nodes.some((column) => activeCards(column).some(matchesCard))) : boards
  const clearDrag = () => {
    setDragged(null)
    setDropTarget(null)
  }
  const dragOver = (event, target, boardId) => {
    if (!dragged || busy || dragged.boardId !== boardId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== target) setDropTarget(target)
  }
  const dropCard = (event, project, stage, beforeCardId = null) => {
    event.preventDefault()
    event.stopPropagation()
    const matches = project.boardColumnsByBoardId.nodes.filter((item) => columnKey(item) === stage.id)
    const stageIds = new Set(matches.map((item) => item.id))
    const beforeCard = beforeCardId ? matches.flatMap((item) => activeCards(item)).find((card) => card.id === beforeCardId) : null
    const targetColumnId = beforeCard?.columnId || matches[0]?.id
    // Dropping on the same stage background keeps the card where it is.
    const unchanged = !beforeCardId && dragged && stageIds.has(dragged.columnId)
    if (dragged && !busy && dragged.boardId === project.id && targetColumnId && dragged.cardId !== beforeCardId && !unchanged) {
      const sameScope = beforeCard && (beforeCard.parentId || null) === (draggedCard.parentId || null) && (draggedCard.parentId || beforeCard.epic === draggedCard.epic)
      onMoveCard(dragged.cardId, targetColumnId, sameScope ? beforeCard.id : null, project.id)
    }
    clearDrag()
  }
  return <Matrix rows={rows} columns={columns} rowLabel="Project" label="Projects by board column" className="kanban__project-matrix" aria-busy={busy} devId={devId} rowDevId="8xmeg3d" colDevId="vr4xa53"
    renderRowHeader={(project) => <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSelectBoard(project.id)} devId="2w2riek">{project.title}</Button>}
    renderCell={(project, column) => {
      const matches = project.boardColumnsByBoardId.nodes.filter((item) => columnKey(item) === column.id)
      if (!matches.length) return null
      const cards = matches.flatMap((item) => activeCards(item)).filter(matchesCard)
      const countOnly = column.id === 'done'
      const cellKey = `${project.id}:${column.id}`
      return <div className={`kanban__cards kanban__matrix-cell ${dropTarget === cellKey ? 'kanban__drop-target' : ''}`} onDragOver={(event) => dragOver(event, cellKey, project.id)} onDrop={(event) => dropCard(event, project, column)}>
        <span className="kanban__matrix-card-count">{cards.length} cards</span>
        {!countOnly && cards.map((card) => <DevScope key={card.id} id="b9bhybr" state={{ card: card.id }}>
          <article className={`kanban__task-card ${dragged?.cardId === card.id ? 'kanban__dragging' : ''} ${dropTarget === card.id ? 'kanban__drop-before' : ''}`}>
            <DevScope id="20wmwyd">
              <button className="kanban__card-content" draggable={!busy} disabled={busy} onDragStart={(event) => { suppressClick.current = true
      setDragged(card.id)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', card.id) }} onDragEnd={() => { clearDrag()
      setTimeout(() => { suppressClick.current = false }, 0) }} onDragOver={(event) => dragOver(event, card.id, project.id)} onDrop={(event) => dropCard(event, project, column, card.id)} onClick={() => { if (suppressClick.current) return
      onOpenCard(project.id, card) }}><span>{card.title}</span>{card.description && <small>{card.description}</small>}<small>By {card.userByAuthorId?.name || 'Unknown author'}</small></button>
            </DevScope>
            <CardRelationships card={card} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} />
          </article>
        </DevScope>)}
      </div>
    }} />
}
const BoardLayout = ({ scoped, children }) => {
  if (scoped) return Children.toArray(children)[1]
  return <SplitPane devId="7tb882x" defaultSize={236} minSize={200} maxSize={480} storageKey="kanban-sidebar-width" stackBelow={760} stackedSize="auto">{children}</SplitPane>
}

const BoardWorkspace = ({ devId, user, onSwitchUser, allBoards, scopedBoardId = '', workspaceId }) => {
  const { url, navigate } = useBrowserLocation()
  const [scopedTaskId, setScopedTaskId] = useState('')
  const route = scopedBoardId
    ? { boardId: scopedBoardId, taskId: scopedTaskId, view: 'board', invalid: false }
    : readRoute(url)
  const { view } = route
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const matchesCard = (card) => !query || `${card.title}\n${card.description || ''}`.toLowerCase().includes(query)
  const boards = allBoards.nodes
  const hierarchy = useMemo(() => createCardHierarchy(boards), [boards])
  const board = route.invalid ? null : route.boardId
    ? boards.find((item) => item.id === route.boardId) || null
    : boards.find((item) => item.id === rememberedBoard()) || boards[0] || null
  const activeId = board?.id || ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorKind, setEditorKind] = useState('')
  const [editorId, setEditorId] = useState('')
  const [newCard, setNewCard] = useState({})
  const setEditor = (value) => {
    setEditorKind(value?.kind || '')
    setEditorId(value?.item?.id || '')
    setNewCard(value?.item || {})
  }
  const mutationLock = useRef(false)
  const columns = board?.boardColumnsByBoardId.nodes || []
  const task = route.taskId ? columns.flatMap((column) => column.cardsByColumnId.nodes).find((card) => card.id === route.taskId) : null
  const localItem = editorKind === 'board' ? boards.find((item) => item.id === editorId) : columns.find((item) => item.id === editorId)
  const localEditor = editorKind ? { kind: editorKind, item: localItem || newCard, boardId: activeId } : null
  const editor = route.taskId ? (task ? { kind: 'card', item: task, boardId: activeId } : null) : localEditor
  const routeError = route.invalid ? 'This page could not be found.' : route.boardId && !board
    ? 'This board could not be found.' : route.taskId && !task ? 'This task could not be found on this board.' : ''
  const visibleBoards = view === 'matrix' ? boards : board ? [board] : []
  const cardCount = visibleBoards.reduce((total, item) => total + item.boardColumnsByBoardId.nodes.reduce((count, column) => count + activeCards(column).length, 0), 0)
  const matchingCount = visibleBoards.reduce((total, item) => total + item.boardColumnsByBoardId.nodes.reduce((count, column) => count + activeCards(column).filter(matchesCard).length, 0), 0)
  const fullPageUrl = new URL(routeUrl(url, { boardId: activeId, taskId: route.taskId }))
  if (workspaceId) fullPageUrl.searchParams.set('workspace', workspaceId)

  useEffect(() => {
    if (scopedBoardId) return
    const id = board?.id || ''
    try { localStorage.setItem('kanban-board', id) } catch { /* Storage is optional. */ }
  }, [board?.id, scopedBoardId])
  useEffect(() => {
    if (!scopedBoardId && !route.invalid && !route.boardId && board) {
      navigate(routeUrl(url, { boardId: board.id, view }), { replace: true })
    }
  }, [url.href, board?.id, route.invalid, route.boardId, view, navigate, scopedBoardId])
  useEffect(() => {
    setEditor(null)
    setError('')
  }, [url.href])
  const navigateTo = (state, options) => {
    setEditor(null)
    setError('')
    if (scopedBoardId && (!state.boardId || state.boardId === scopedBoardId)) {
      setScopedTaskId(state.taskId || '')
      return
    }
    // Related tasks on another board open the full page, outside this popup.
    navigate(routeUrl(url, { boardId: activeId, view, ...state }), options)
  }
  const closeEditor = () => {
    setEditor(null)
    setError('')
    if (route.taskId) navigateTo({})
  }
  const change = async (operation, { close = false, boardId } = {}) => {
    if (mutationLock.current) return
    mutationLock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      // Do not redirect a user who navigated away while the mutation was pending.
      if (window.location.href === url.href) {
        if (result?.createBoard?.board?.id) navigateTo({ boardId: result.createBoard.board.id, view: 'board' })
        else if (result?.deleteBoard) {
          const deletedId = result.deleteBoard.board?.id
          if (deletedId === activeId) navigateTo({ boardId: boards.find((item) => item.id !== deletedId)?.id || '' }, { replace: true })
        }
        else if (close) {
          if (boardId && boardId !== activeId && !scopedBoardId) navigateTo({ boardId }, { replace: true })
          else closeEditor()
        }
      }
      return result
    } catch (failure) {
      setError(failure.message)
    } finally {
      mutationLock.current = false
      setBusy(false)
    }
  }
  const selectBoard = (id) => {
    navigateTo({ boardId: id, view: 'board' })
  }
  const openEditor = (kind, item = {}, boardId = activeId) => {
    setError('')
    if (kind === 'card' && item.id) navigateTo({ boardId, taskId: item.id })
    else setEditor({ kind, item })
  }
  const save = ({ title, description, columnId, parentId, epic }) => {
    const destination = editor.kind === 'card' ? boards.find((board) => board.boardColumnsByBoardId.nodes.some((column) => column.id === columnId)) : null
    return change(() => {
      const { kind, item } = editor
      if (kind === 'card') {
        if (!destination) throw new Error('Choose a board with a valid column before saving.')
        if (parentId) {
          const parent = hierarchy.getCard(parentId)
          if (!parent || parent.id === item.id || parent.parentId || !parent.epic) throw new Error('Choose an epic as the parent, or remove the parent.')
          if (hierarchy.getChildren(item.id).length) throw new Error('A task with children, including archived children, cannot have a parent.')
        }
        if (!epic && hierarchy.getChildren(item.id).length) throw new Error('A task with children must stay an epic.')
        return saveCard(item, title, description, columnId, user.id, destination.id, parentId, Boolean(epic))
      }
      const type = kind === 'board' ? 'Board' : 'BoardColumn'
      if (item.id) return mutate(`update${type}ById`, `Update${type}ByIdInput`, { id: item.id, [`${kind}Patch`]: { title } }, undefined, kind === 'board' ? undefined : activeId)
      return mutate(`create${type}`, `Create${type}Input`, { [kind]: { title, ...(kind === 'boardColumn' ? { boardId: activeId } : {}) } }, undefined, kind === 'board' ? undefined : activeId)
    }, { close: true, boardId: destination?.id })
  }
  const remove = ({ kind, item }) => {
    const noun = kind === 'boardColumn' ? 'column' : kind
    const contents = kind === 'board' ? ' and all its columns and cards' : kind === 'boardColumn' ? ' and all its cards' : ''
    const children = kind === 'card' && hierarchy.getChildren(item.id).length ? ' Its children will become root tasks.' : ''
    if (!window.confirm(`Delete ${noun} “${item.title}”${contents}? This cannot be undone.${children}`)) return
    const type = kind === 'boardColumn' ? 'BoardColumn' : kind === 'board' ? 'Board' : 'Card'
    change(() => mutate(`delete${type}ById`, `Delete${type}ByIdInput`, { id: item.id }, undefined, kind === 'board' ? undefined : editor?.boardId || activeId), { close: true })
  }
  // Archived cards leave the column order; restoring appends them to the end.
  const toggleArchive = (card, options) => change(() => (card.archivedAt ? restoreCard : archiveCard)(card.id, editor?.boardId || activeId), options)
  return (
    <DevScope id={devId} state={{ board: activeId, busy }}>
        <div className="kanban__workspace">
          <BoardLayout scoped={Boolean(scopedBoardId)}>
          <DevScope id="j56xrh1">
          <aside className="kanban__sidebar" inert={Boolean(editor)}>
            <div className="kanban__brand"><span aria-hidden="true">▥</span> Kanban</div>
            <div className="kanban__board-views" role="group" aria-label="Workspace view">
              <Button variant={view === 'board' ? 'primary' : 'ghost'} size="sm" aria-pressed={view === 'board'} disabled={busy} onClick={() => navigateTo({ view: 'board' })} devId="707ej5f">Board</Button>
              <Button variant={view === 'matrix' ? 'primary' : 'ghost'} size="sm" aria-pressed={view === 'matrix'} disabled={busy} onClick={() => navigateTo({ view: 'matrix' })} devId="mclggxw">Matrix</Button>
            </div>
            <div className="kanban__sidebar-heading">Your boards <span>{boards.length}</span></div>
            <nav aria-label="Boards">
              {boards.map((item) => <DevScope key={item.id} id="p9u300x" state={{ board: item.id }}>
                <div className={`kanban__board-item ${view === 'board' && item.id === activeId ? 'kanban__active' : ''}`}>
                  <button className="kanban__board-link" aria-current={view === 'board' && item.id === activeId ? 'page' : undefined} disabled={busy} onClick={() => selectBoard(item.id)}>
                    <span aria-hidden="true">▤</span><span>{item.title}</span>
                  </button>
                  <div className="kanban__board-item-actions">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => openEditor('board', item)} aria-label={`Edit ${item.title}`} devId="wl6e4hr">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </Button>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => remove({ kind: 'board', item })} aria-label={`Delete ${item.title}`} devId="dv3k1xt">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </Button>
                  </div>
                </div>
              </DevScope>)}
            </nav>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => openEditor('board')} devId="5f2y536">+ New board</Button>
            <div className="kanban__sidebar-footer"><span>Signed in as <strong>{user.name}</strong></span><Button variant="secondary" size="sm" disabled={busy} onClick={onSwitchUser} devId="yen2yfb">Switch user</Button></div>
          </aside>
          </DevScope>
          <main className="kanban__main" inert={Boolean(editor)}>
            <header className="kanban__board-header">
              <div className="kanban__eyebrow">{scopedBoardId ? board?.title || 'Workspace board' : `MY WORKSPACE / ${view === 'matrix' ? 'MATRIX' : 'BOARD'}`}</div>
              <DevScope id="86i9hrw"><FormInput type="search" className="kanban__search" field={{ value: search, onChange: (event) => setSearch(event.target.value) }} aria-label={view === 'matrix' ? 'Search cards across all projects' : 'Search cards on this board'} placeholder={view === 'matrix' ? 'Search all projects’ cards…' : 'Search this board’s cards…'} /></DevScope>
              <span role="status">{busy ? 'Saving…' : query ? `${matchingCount} of ${cardCount} cards` : `${cardCount} cards`}</span>
              {scopedBoardId && <Button variant="ghost" size="sm" disabled={busy} onClick={onSwitchUser}>Switch user</Button>}
              {scopedBoardId && board && <a className="kanban__expand" href={fullPageUrl.href} aria-label={`Open ${board.title} full page`}>Full page <span aria-hidden="true">↗</span></a>}
            </header>
            {error && !editor && <div className="kanban__error-banner" role="alert">{error}<Button variant="secondary" size="sm" disabled={busy} onClick={() => setError('')} devId="vva6h9m">Dismiss</Button></div>}
            {routeError && <div className="kanban__error-banner" role="alert">{routeError}</div>}
            {query && matchingCount === 0 && <p className="kanban__search-empty" role="status">No matching cards. Try another search or clear the search.</p>}
            {!board && !error && !routeError && <div className="kanban__empty-state"><span aria-hidden="true">▥</span><h2>A little space to get things done.</h2><p>Create a board for your next project.</p><Button onClick={() => openEditor('board')} devId="gh69869">Create a board</Button></div>}
            {view === 'matrix' && boards.length > 0 && <ProjectMatrix devId="dg0n347" boards={boards} hierarchy={hierarchy} busy={busy} matchesCard={matchesCard} searching={Boolean(query)} onSelectBoard={selectBoard} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} onMoveCard={(cardId, columnId, beforeCardId, boardId) => change(() => moveCard(cardId, columnId, beforeCardId, boardId))} />}
            {view === 'board' && board && <KanbanRows key={board.id} board={board} hierarchy={hierarchy} busy={busy} searching={Boolean(query)} matchesCard={matchesCard}
              onOpenCard={(boardId, item) => openEditor('card', item, boardId)} onNewCard={(item) => openEditor('card', item)}
              onEditColumn={(column) => openEditor('boardColumn', column)} onNewColumn={() => openEditor('boardColumn')}
              onMoveColumn={(columnId, beforeColumnId) => change(() => moveColumn(columnId, beforeColumnId, activeId))} onArchive={toggleArchive}
              onMoveCard={(cardId, columnId, beforeCardId) => change(() => moveCard(cardId, columnId, beforeCardId, activeId))}
              onMoveTask={(cardId, columnId, parentId, beforeCardId) => change(() => moveTask(cardId, columnId, parentId, beforeCardId, activeId))}
              onMoveEpic={(epicId, beforeEpicId) => change(() => moveEpicRow(activeId, epicId, beforeEpicId))} />}
          </main>
          </BoardLayout>
          <PopupDisplay backdropDevId="v3varah" closeDevId="dhzhr12" contentDevId="tsk9wm9" devId="2foeazy" isOpen={Boolean(editor)} close={() => { if (!busy) closeEditor() }} lockScroll={!scopedBoardId} panelClassName="kanban__editor">
            {editor ? <Editor devId="z22w4qd" user={user} key={`${editor.kind}-${editor.item.id || 'new'}`} editor={editor} boards={boards} hierarchy={hierarchy} busy={busy} error={error} onSave={save} onDelete={() => remove(editor)} onArchive={() => toggleArchive(editor.item, { close: !editor.item.archivedAt })} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} onCommentChange={change} /> : <span />}
          </PopupDisplay>
        </div>
      </DevScope>
  )
}
const KanbanBoard = (props) => {
  return <KanbanQuery devId="on6tiv6" query={BOARDS_QUERY}><BoardWorkspace {...props} /></KanbanQuery>
}

export default KanbanBoard
