import { ContextMenu, DevScope, TreeRow, TreeView } from 'component-library'
import { isDirty } from './useOpenFiles'
import { joinPath } from './paths'

const PENDING = '\u0000pending'

const getId = (item) => item.path
const isBranch = (item) => item.type === 'dir'

const menuItems = (explorer, files) => ({ item } = {}) => {
  if (!item) {
    return [
      { id: 'new-file', label: 'New File…', run: () => explorer.startCreate('file', null) },
      { id: 'new-folder', label: 'New Folder…', run: () => explorer.startCreate('dir', null) },
      { separator: true },
      { id: 'refresh', label: 'Refresh', run: () => explorer.refresh(null) },
    ]
  }
  if (item.type === 'dir') {
    return [
      { id: 'new-file', label: 'New File…', run: () => explorer.startCreate('file', item) },
      { id: 'new-folder', label: 'New Folder…', run: () => explorer.startCreate('dir', item) },
      { separator: true },
      { id: 'rename', label: 'Rename…', shortcut: 'F2', run: () => explorer.startRename(item) },
      { id: 'delete', label: 'Delete', shortcut: 'Del', danger: true, run: () => explorer.remove(item) },
      { separator: true },
      { id: 'refresh', label: 'Refresh', run: () => explorer.refresh(item) },
      { id: 'copy-path', label: 'Copy Path', run: () => explorer.copyPath(item) },
    ]
  }
  return [
    { id: 'open', label: 'Open', run: () => files.open(item.path) },
    { separator: true },
    { id: 'rename', label: 'Rename…', shortcut: 'F2', run: () => explorer.startRename(item) },
    { id: 'delete', label: 'Delete', shortcut: 'Del', danger: true, run: () => explorer.remove(item) },
    { separator: true },
    { id: 'copy-path', label: 'Copy Path', run: () => explorer.copyPath(item) },
    { id: 'copy-relative-path', label: 'Copy Relative Path', run: () => explorer.copyPath(item, true) },
  ]
}

const CopyPathButton = ({ item, onCopy }) => (
  <button
    type="button"
    className="file-tree__copy"
    aria-label={`Copy path ${item.path}`}
    title="Copy path"
    onClick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      onCopy(item)
    }}
    onDoubleClick={(event) => {
      event.preventDefault()
      event.stopPropagation()
    }}
  >
    <svg className="file-tree__copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  </button>
)

const Row = ({ item, tree, explorer, dirtyPaths, errors }) => {
  const error = errors[item.path]
  return (
    <TreeRow
      item={item}
      tree={tree}
      label={item.name}
      editing={Boolean(item.pending) || explorer.editingPath === item.path}
      editValue={item.name}
      commitEdit={(value) => (item.pending ? explorer.commitCreate(value) : explorer.commitRename(item, value))}
      cancelEdit={explorer.cancel}
      muted={item.name.startsWith('.')}
      title={item.pending ? undefined : item.path}
      className={item.pending ? 'file-tree__row--pending' : undefined}
    >
      {error && <span className="file-tree__row-error" title={error}>{error}</span>}
      {dirtyPaths.has(item.path) && <span className="file-tree__dirty" aria-label="Unsaved changes" />}
      {item.symlink && (
        <svg className="file-tree__symlink" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Symbolic link">
          <title>Symbolic link</title>
          <path d="M5 19v-6a5 5 0 0 1 5-5h9m-5-5 5 5-5 5" />
        </svg>
      )}
      {!item.pending && (
        <CopyPathButton
          item={item}
          onCopy={(entry) => {
            explorer.setSelectedId(entry.path)
            explorer.copyPath(entry)
          }}
        />
      )}
    </TreeRow>
  )
}

const FileTreeTree = ({ contextMenu, tree, explorer, files }) => {
  const { pending } = explorer
  const pendingItem = pending
    ? { name: '', path: joinPath(pending.parent, PENDING), type: pending.type, pending: true }
    : null
  const withPending = (parent, entries) =>
    pendingItem && pending.parent === parent ? [pendingItem, ...(entries || [])] : entries

  const rootEntries = tree.childrenByPath['']
  const roots = withPending('', rootEntries) || []
  const rootError = tree.errors['']
  const dirtyPaths = new Set(files.tabs.filter(isDirty).map((tab) => tab.path))

  const getChildren = (item) => (item.pending ? [] : withPending(item.path, tree.childrenByPath[item.path]))
  const loadChildren = (item) => (item.pending ? Promise.resolve() : tree.load(item.path))

  const openMenu = (event, item) => {
    event.preventDefault()
    if (item?.pending) return
    if (item) explorer.setSelectedId(item.path)
    contextMenu.open(event, { item: item || null })
  }

  const onKeyDown = (event, item) => {
    if (!item || item.pending || explorer.editingPath || explorer.pending) return
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
    if (event.key === 'F2') {
      event.preventDefault()
      explorer.startRename(item)
    } else if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)) {
      event.preventDefault()
      explorer.remove(item)
    }
  }

  return (
    <div
      className="file-tree"
      onContextMenu={(event) => {
        if (!event.defaultPrevented) openMenu(event, null)
      }}
    >
      {rootError && <p className="file-tree__error" role="alert">{rootError}</p>}
      {explorer.error && (
        <p className="file-tree__error" role="alert">
          <span>{explorer.error}</span>
          <button type="button" className="file-tree__dismiss" aria-label="Dismiss" onClick={explorer.clearError}>×</button>
        </p>
      )}
      <div className="file-tree__body">
        {!rootEntries && !rootError && <p className="file-tree__hint">Loading…</p>}
        {rootEntries && roots.length === 0 && <p className="file-tree__hint">This folder is empty.</p>}
        <div className="file-tree__viewport">
          <TreeView
            devId="v43f002"
            roots={roots}
            getId={getId}
            getChildren={getChildren}
            isBranch={isBranch}
            loadChildren={loadChildren}
            expandedIds={tree.expandedIds}
            onExpandedChange={tree.setExpandedIds}
            selectedId={explorer.selectedId}
            onSelect={(item) => {
              if (!item.pending) explorer.setSelectedId(item.path)
            }}
            open={(item) => {
              if (!item.pending && item.type === 'file') files.open(item.path)
            }}
            onRowContextMenu={openMenu}
            onKeyDown={onKeyDown}
            indent={12}
          >
            <Row explorer={explorer} dirtyPaths={dirtyPaths} errors={tree.errors} />
          </TreeView>
        </div>
      </div>
    </div>
  )
}

const FileTree = ({ devId, tree, explorer, files }) => (
  <DevScope id={devId} state={{ selected: explorer.selectedId, editing: Boolean(explorer.editingPath), creating: explorer.pending?.type || null }}>
    <ContextMenu devId="tqz4eq2" items={menuItems(explorer, files)}>
      <FileTreeTree tree={tree} explorer={explorer} files={files} />
    </ContextMenu>
  </DevScope>
)

export default FileTree
