import { useEffect, useMemo, useRef, useState } from 'react'
import { readRoute, routeUrl } from './navigation'
import { BOARDS_QUERY, archiveCard, mutate, moveCard, moveColumn, restoreCard, saveCard } from './api'
import TaskComments from './TaskComments'
import CardRelationships from './CardRelationships'
import { createCardHierarchy } from './hierarchy'
import { Button, PopupDisplay, OrderDisplay, Matrix, FormInput, DevScope, Fold, FoldTrigger, FoldContent, SplitPane, useBrowserLocation } from 'component-library'
import KanbanQuery from './KanbanQuery'



const Editor = ({ devId, user, editor, columns, hierarchy, busy, error, onSave, onDelete, onArchive, onOpenCard, onCommentChange, popup }) => {
  const [title, setTitle] = useState(editor.item.title || '')
  const [description, setDescription] = useState(editor.item.description || '')
  const [columnId, setColumnId] = useState(editor.item.columnId || '')
  const [parentId, setParentId] = useState(editor.item.parentId || '')
  const children = hierarchy.getChildren(editor.item.id)
  const parents = hierarchy.getParents(editor.item.id)
  const unavailableParent = parentId && !parents.some((card) => card.id === parentId)
  const noun = editor.kind === 'boardColumn' ? 'column' : editor.kind
  return (
    <DevScope id={devId} state={{ mode: editor.kind, item: editor.item.id || undefined, busy: busy || undefined }}>
    <div role="dialog" aria-modal="true" aria-label={`${editor.item.id ? 'Edit' : 'New'} ${noun}`}>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (title.trim()) onSave({ title: title.trim(), description, columnId, parentId: parentId || null })
    }}>
      <h2>{editor.item.id ? `Edit ${noun}` : `New ${noun}`}</h2>
      {editor.kind === 'card' && editor.item.id && <p className="kanban__comments-empty">Created by {editor.item.userByAuthorId?.name || 'Unknown author'}{editor.item.archivedAt && ' · Archived'}</p>}
      <fieldset disabled={busy}>
        <label>Title<DevScope id="ox3tq2n"><input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></DevScope></label>
        {editor.kind === 'card' && <>
          <DevScope id="dw8r404"><label>Description<textarea rows={7} maxLength={20000} placeholder="Add a little more detail…" value={description} onChange={(event) => setDescription(event.target.value)} /></label></DevScope>
          <label>Column<DevScope id="ntbho75"><select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
          </select></DevScope></label>
          <label>Parent task<select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-describedby="kanban-parent-help">
            <option value="">No parent (root task)</option>
            {unavailableParent && <option value={parentId} disabled>Current parent cannot be kept — remove it</option>}
            {parents.map((card) => <option key={card.id} value={card.id}>{card.title} · {card.boardTitle}{card.archivedAt ? ' · Archived' : ''}</option>)}
          </select></label>
          <p id="kanban-parent-help" className="kanban__comments-empty">{children.length
            ? 'This task is an epic. Remove or reassign its children, including archived children, before choosing a parent.'
            : 'Choose a root task to make this its child. Choose No parent to remove the relationship.'}</p>
          {editor.item.id && <CardRelationships card={hierarchy.getCard(editor.item.id) || editor.item} hierarchy={hierarchy} busy={busy} onOpenCard={onOpenCard} expanded />}
        </>}
        {error && <p role="alert" className="kanban__error">{error}</p>}
        <div className="kanban__editor-actions">
          {editor.item.id && <Button type="button" variant="danger" size="sm" onClick={onDelete} devId="ce03obf">Delete {noun}</Button>}
          {editor.kind === 'card' && editor.item.id && <Button type="button" variant="secondary" size="sm" onClick={onArchive} devId="ilzmmz9">{editor.item.archivedAt ? 'Restore card' : 'Archive card'}</Button>}
          <span />
          <Button type="button" variant="secondary" size="sm" onClick={popup.close} devId="43vqubf">Cancel</Button>
          <Button type="submit" size="sm" disabled={!title.trim()} devId="wd0pmd7">{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </fieldset>
    </form>
    {editor.kind === 'card' && (editor.item.id
      ? <TaskComments devId="d6klsew" user={user} cardId={editor.item.id} busy={busy} onChange={onCommentChange} />
      : <p className="kanban__comments-empty">Save this card to add comments.</p>)}
    </div>
    </DevScope>
  )
}
const rememberedBoard = () => {
  try { return localStorage.getItem('kanban-board') || '' } catch { return '' }
}
// Columns load every card; ordering only applies to the active ones.
const activeCards = (column) => column.cardsByColumnId.nodes.filter((card) => !card.archivedAt)
const archivedCards = (column) => column.cardsByColumnId.nodes.filter((card) => card.archivedAt)
  .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
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
      onMoveCard(dragged.cardId, targetColumnId, beforeCard?.id || null, project.id)
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
const BoardWorkspace = ({ devId, user, onSwitchUser, allBoards }) => {
  const { url, navigate } = useBrowserLocation()
  const route = readRoute(url)
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
  const [newColumnId, setNewColumnId] = useState('')
  const setEditor = (value) => {
    setEditorKind(value?.kind || '')
    setEditorId(value?.item?.id || '')
    setNewColumnId(value?.item?.columnId || '')
  }
  const [dragged, setDragged] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [collapsedIds, setCollapsedIds] = useState([])
  const toggleColumn = (id) => setCollapsedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const mutationLock = useRef(false)
  const columns = board?.boardColumnsByBoardId.nodes || []
  const task = route.taskId ? columns.flatMap((column) => column.cardsByColumnId.nodes).find((card) => card.id === route.taskId) : null
  const localItem = editorKind === 'board' ? boards.find((item) => item.id === editorId) : columns.find((item) => item.id === editorId)
  const localEditor = editorKind ? { kind: editorKind, item: localItem || { columnId: newColumnId } } : null
  const editor = route.taskId ? (task ? { kind: 'card', item: task, boardId: activeId } : null) : localEditor
  const routeError = route.invalid ? 'This page could not be found.' : route.boardId && !board
    ? 'This board could not be found.' : route.taskId && !task ? 'This task could not be found on this board.' : ''
  const editorColumns = editor?.boardId ? boards.find((item) => item.id === editor.boardId)?.boardColumnsByBoardId.nodes || [] : columns
  const visibleBoards = view === 'matrix' ? boards : board ? [board] : []
  const cardCount = visibleBoards.reduce((total, item) => total + item.boardColumnsByBoardId.nodes.reduce((count, column) => count + activeCards(column).length, 0), 0)
  const matchingCount = visibleBoards.reduce((total, item) => total + item.boardColumnsByBoardId.nodes.reduce((count, column) => count + activeCards(column).filter(matchesCard).length, 0), 0)

  useEffect(() => {
    const id = board?.id || ''
    try { localStorage.setItem('kanban-board', id) } catch { /* Storage is optional. */ }
  }, [board?.id])
  useEffect(() => {
    if (!route.invalid && !route.boardId && board) {
      navigate(routeUrl(url, { boardId: board.id, view }), { replace: true })
    }
  }, [url.href, board?.id, route.invalid, route.boardId, view, navigate])
  useEffect(() => {
    setEditor(null)
    setError('')
  }, [url.href])
  const navigateTo = (state, options) => {
    setEditor(null)
    setError('')
    navigate(routeUrl(url, { boardId: activeId, view, ...state }), options)
  }
  const closeEditor = () => {
    setEditor(null)
    setError('')
    if (route.taskId) navigateTo({})
  }
  const change = async (operation, { close = false } = {}) => {
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
        else if (close) closeEditor()
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
  const save = ({ title, description, columnId, parentId }) => change(() => {
    const { kind, item } = editor
    if (kind === 'card') {
      if (parentId) {
        const parent = hierarchy.getCard(parentId)
        if (!parent || parent.id === item.id || parent.parentId) throw new Error('Choose another root task as the parent, or remove the parent.')
        if (hierarchy.getChildren(item.id).length) throw new Error('A task with children, including archived children, cannot have a parent.')
      }
      return saveCard(item, title, description, columnId, user.id, editor.boardId || activeId, parentId)
    }
    const type = kind === 'board' ? 'Board' : 'BoardColumn'
    if (item.id) return mutate(`update${type}ById`, `Update${type}ByIdInput`, { id: item.id, [`${kind}Patch`]: { title } }, undefined, kind === 'board' ? undefined : activeId)
    return mutate(`create${type}`, `Create${type}Input`, { [kind]: { title, ...(kind === 'boardColumn' ? { boardId: activeId } : {}) } }, undefined, kind === 'board' ? undefined : activeId)
  }, { close: true })
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
  const reorderCard = (column, cardId, direction) => {
    const cards = activeCards(column)
    const index = cards.findIndex((card) => card.id === cardId)
    change(() => moveCard(cardId, column.id, cards[index + (direction === 'up' ? -1 : 2)]?.id || null, activeId))
  }
  const drop = (event, columnId, beforeCardId = null) => {
    event.preventDefault()
    event.stopPropagation()
    if (dragged && !busy) change(() => moveCard(dragged, columnId, beforeCardId, activeId))
    setDragged(null)
    setDropTarget(null)
  }
  const dragOver = (event, target) => {
    if (!dragged || busy) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }
  return (
    <DevScope id={devId} state={{ board: activeId, busy }}>
        <div className="kanban__workspace">
          <SplitPane devId="7tb882x" defaultSize={236} minSize={200} maxSize={480} storageKey="kanban-sidebar-width" stackBelow={760} stackedSize="auto">
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
              <div className="kanban__eyebrow">MY WORKSPACE / {view === 'matrix' ? 'MATRIX' : 'BOARD'}</div>
              <DevScope id="86i9hrw"><FormInput type="search" className="kanban__search" field={{ value: search, onChange: (event) => setSearch(event.target.value) }} aria-label={view === 'matrix' ? 'Search cards across all projects' : 'Search cards on this board'} placeholder={view === 'matrix' ? 'Search all projects’ cards…' : 'Search this board’s cards…'} /></DevScope>
              <span role="status">{busy ? 'Saving…' : query ? `${matchingCount} of ${cardCount} cards` : `${cardCount} cards`}</span>
            </header>
            {error && !editor && <div className="kanban__error-banner" role="alert">{error}<Button variant="secondary" size="sm" disabled={busy} onClick={() => setError('')} devId="vva6h9m">Dismiss</Button></div>}
            {routeError && <div className="kanban__error-banner" role="alert">{routeError}</div>}
            {query && matchingCount === 0 && <p className="kanban__search-empty" role="status">No matching cards. Try another search or clear the search.</p>}
            {!board && !error && !routeError && <div className="kanban__empty-state"><span aria-hidden="true">▥</span><h2>A little space to get things done.</h2><p>Create a board for your next project.</p><Button onClick={() => openEditor('board')} devId="gh69869">Create a board</Button></div>}
            {view === 'matrix' && boards.length > 0 && <ProjectMatrix devId="dg0n347" boards={boards} hierarchy={hierarchy} busy={busy} matchesCard={matchesCard} searching={Boolean(query)} onSelectBoard={selectBoard} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} onMoveCard={(cardId, columnId, beforeCardId, boardId) => change(() => moveCard(cardId, columnId, beforeCardId, boardId))} />}
            {view === 'board' && <DevScope id="4aob8se">
              <div className="kanban__board-canvas" aria-busy={busy}>
                {columns.map((column, columnIndex) => {
                  const collapsed = !query && collapsedIds.includes(column.id)
                  const columnCount = activeCards(column).filter(matchesCard).length
                  return <DevScope key={column.id} id="crlq97n" state={{ column: column.id, collapsed }}>
                  <section className={`kanban__column${collapsed ? ' kanban__column--collapsed' : ''} ${dropTarget === column.id ? 'kanban__drop-target' : ''}`} aria-label={column.title} onDragOver={(event) => dragOver(event, column.id)} onDrop={(event) => drop(event, column.id)}>
                  {collapsed ? <button type="button" className="kanban__column-collapsed" aria-expanded="false" aria-label={`Expand ${column.title}, ${columnCount} cards`} title={`${column.title} (${columnCount})`} disabled={busy} onClick={() => toggleColumn(column.id)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button> : <>
                  <div className="kanban__column-heading"><h2>{column.title} <span>{columnCount}</span></h2><button type="button" className="kanban__icon-button" aria-expanded="true" aria-label={`Collapse ${column.title}`} disabled={busy} onClick={() => toggleColumn(column.id)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button><DevScope id="rweodgf"><button className="kanban__icon-button" aria-label={`Edit ${column.title}`} disabled={busy} onClick={() => openEditor('boardColumn', column)}>•••</button></DevScope></div>
                  <div className="kanban__column-order"><DevScope id="z9ie0cx"><button disabled={busy || columnIndex === 0} aria-label={`Move ${column.title} left`} onClick={() => change(() => moveColumn(column.id, columns[columnIndex - 1].id, activeId))}>←</button></DevScope><DevScope id="nwp8rty"><button disabled={busy || columnIndex === columns.length - 1} aria-label={`Move ${column.title} right`} onClick={() => change(() => moveColumn(column.id, columns[columnIndex + 2]?.id || null, activeId))}>→</button></DevScope></div>
                  <div className="kanban__cards">
                    {activeCards(column).map((card, index) => matchesCard(card) && <DevScope key={card.id} id="wtikblu" state={{ card: card.id }}>
                      <article className={`kanban__task-card ${dragged === card.id ? 'kanban__dragging' : ''} ${dropTarget === card.id ? 'kanban__drop-before' : ''}`} draggable={!busy} onDragStart={(event) => { setDragged(card.id)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', card.id) }} onDragEnd={() => { setDragged(null)
      setDropTarget(null) }} onDragOver={(event) => dragOver(event, card.id)} onDrop={(event) => drop(event, column.id, card.id)}>
                        <DevScope id="azspmti">
                          <button className="kanban__card-content" disabled={busy} onClick={() => openEditor('card', card)}><span>{card.title}</span>{card.description && <small>{card.description}</small>}<small>By {card.userByAuthorId?.name || 'Unknown author'}</small></button>
                        </DevScope>
                        <CardRelationships card={card} hierarchy={hierarchy} busy={busy} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} />
                        <div className="kanban__card-footer"><span className="kanban__card-hint">{card.description ? '≡ Description' : 'Drag to move'}</span><span className="kanban__card-actions"><DevScope id="rsyskc2"><button className="kanban__icon-button" aria-label={`Archive ${card.title}`} disabled={busy} onClick={() => toggleArchive(card)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg></button></DevScope><OrderDisplay id={card.id} order={index + 1} totalCount={activeCards(column).length} updating={busy} move={(id, direction) => reorderCard(column, id, direction)} /></span></div>
                      </article>
                    </DevScope>)}
                    {!activeCards(column).some(matchesCard) && <div className="kanban__empty-column">{query ? 'No matching cards' : 'Drop a card here'}</div>}
                  </div>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => openEditor('card', { columnId: column.id })} devId="3ops9cl">+ Add card</Button>
                  {archivedCards(column).some(matchesCard) && <DevScope id="91zejt6"><Fold>
                    <FoldTrigger>Archived {archivedCards(column).filter(matchesCard).length}</FoldTrigger>
                    <FoldContent><ul className="kanban__archived-cards">
                      {archivedCards(column).map((card) => matchesCard(card) && <DevScope key={card.id} id="6lulof0" state={{ card: card.id }}><li>
                        <div className="kanban__archived-details">
                        <button className="kanban__archived-title" disabled={busy} onClick={() => openEditor('card', card)}>{card.title}</button>
                        <CardRelationships card={card} hierarchy={hierarchy} busy={busy} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} />
                        </div>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggleArchive(card)} aria-label={`Restore ${card.title}`} devId="kowenq7">Restore</Button>
                      </li></DevScope>)}
                    </ul></FoldContent>
                  </Fold></DevScope>}
                  </>}
                  </section>
                </DevScope>
                })}
                {board && <Button variant="secondary" disabled={busy} onClick={() => openEditor('boardColumn')} devId="dkl7jve">+ Add column</Button>}
              </div>
            </DevScope>}
          </main>
          </SplitPane>
          <PopupDisplay backdropDevId="v3varah" closeDevId="dhzhr12" contentDevId="tsk9wm9" devId="2foeazy" isOpen={Boolean(editor)} close={() => { if (!busy) closeEditor() }} lockScroll panelClassName="kanban__editor">
            {editor ? <Editor devId="z22w4qd" user={user} key={`${editor.kind}-${editor.item.id || 'new'}`} editor={editor} columns={editorColumns} hierarchy={hierarchy} busy={busy} error={error} onSave={save} onDelete={() => remove(editor)} onArchive={() => toggleArchive(editor.item, { close: !editor.item.archivedAt })} onOpenCard={(boardId, item) => openEditor('card', item, boardId)} onCommentChange={change} /> : <span />}
          </PopupDisplay>
        </div>
      </DevScope>
  )
}
const KanbanBoard = (props) => {
  return <KanbanQuery devId="on6tiv6" query={BOARDS_QUERY}><BoardWorkspace {...props} /></KanbanQuery>
}

export default KanbanBoard
