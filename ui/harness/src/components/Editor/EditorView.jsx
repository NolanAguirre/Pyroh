import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  CodeEditor,
  DevScope,
  FileIcon,
  Media,
  SelectDisplay,
  SplitPane,
  StatusBar,
  StatusBarItem,
} from 'component-library'
import api from '../../api'
import TabStrip from '../TabStrip/tabStrip'
import FileSearch from './FileSearch'
import FileTree from './FileTree'
import useExplorer from './useExplorer'
import useFileTree from './useFileTree'
import useOpenFiles, { isDirty } from './useOpenFiles'
import { absolutePath, baseName, languageFor, mediaFor, parentOf } from './paths'
import './Editor.css'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const ICONS = {
  newFile: 'M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5zM9.5 1.5V5H13M8 7.5v5M5.5 10h5',
  newFolder: 'M1.5 3.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM8 6.5v5M5.5 9h5',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3',
  collapse: 'M2.5 2.5h11v11h-11zM5 8h6',
}

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const MEDIA_LABELS = { image: 'Image', video: 'Video', audio: 'Audio' }

const SHORTCUTS = [
  ['Save', `${MOD}+S`],
  ['Save All', `${MOD}+${IS_MAC ? '⌥' : 'Alt'}+S`],
  ['Close Tab', `${MOD}+W`],
  ['Next / Previous Tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Rename in Explorer', 'F2'],
  ['Delete in Explorer', 'Del'],
]

const isReady = (tab) => Boolean(tab) && !tab.loading && !tab.error && !tab.binary

const formatSize = (size) => {
  if (!size) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const tabItems = (tabs) => {
  const counts = tabs.reduce((acc, tab) => ({ ...acc, [tab.name]: (acc[tab.name] || 0) + 1 }), {})
  return tabs.map((tab) => ({
    id: tab.path,
    label: counts[tab.name] > 1 && parentOf(tab.path) ? `${tab.name} — ${baseName(parentOf(tab.path))}` : tab.name,
    title: tab.path,
    dirty: isDirty(tab),
    icon: <FileIcon name={tab.name} size={14} />,
  }))
}

const FileMessage = ({ tab, workspaceId, onRetry }) => {
  const media = !tab.loading && !tab.error && tab.binary ? mediaFor(tab.name) : null
  const dot = tab.name.lastIndexOf('.')
  return (
    <DevScope id="7rzumtb" state={{ path: tab.path, loading: tab.loading, binary: tab.binary, media, error: Boolean(tab.error) }}>
      <div className={`editor-message${media ? ' editor-message--media' : ''}`}>
        {tab.loading && <p>Loading {tab.name}…</p>}
        {!tab.loading && tab.error && (
          <>
            <p className="editor-message__error">Could not open {tab.name}: {tab.error}</p>
            <Button devId="b3jwena" variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
          </>
        )}
        {media && (
          <div className="editor-message__media">
            <Media
              src={api.fsRawUrl(workspaceId, tab.path)}
              type={media}
              variant="full"
              extension={tab.name.slice(dot + 1)}
              alt={tab.name}
              autoPlay={false}
              loop={false}
              className="editor-message__player"
            />
          </div>
        )}
        {!tab.loading && !tab.error && tab.binary && !media && (
          <p>{tab.name} is a binary file ({formatSize(tab.size)}) and can’t be displayed in the text editor.</p>
        )}
      </div>
    </DevScope>
  )
}

const EmptyState = () => (
  <DevScope id="jui41ej">
    <div className="editor-empty">
      <p className="editor-empty__title">Open a file from the explorer</p>
      <dl className="editor-empty__keys">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label} className="editor-empty__key">
            <dt>{label}</dt>
            <dd><kbd>{keys}</kbd></dd>
          </div>
        ))}
      </dl>
      <p className="editor-empty__hint">Right-click in the explorer for more actions.</p>
    </div>
  </DevScope>
)

const EditorView = ({ devId, workspaces = [], workspace, workspaceId, file = null, onFileChange, onSelectWorkspace, onBack }) => {
  const tree = useFileTree(workspaceId)
  const files = useOpenFiles(workspaceId)
  const explorer = useExplorer({ workspaceId, tree, files })
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 })
  const [reveal, setReveal] = useState(null)
  const { tabs, activePath, activeTab } = files
  const { setSelectedId } = explorer
  const root = tree.root || workspace?.cwd || ''
  const rootName = baseName(root) || workspace?.name || 'Workspace'

  const actions = useRef(null)
  useEffect(() => {
    actions.current = {
      save: () => activePath && files.save(activePath),
      saveAll: files.saveAll,
      close: () => activePath && files.close(activePath),
      cycle: files.cycle,
    }
  })

  const keys = useMemo(() => [
    { key: 'Mod-s', run: () => { actions.current?.save(); return true } },
    { key: 'Mod-Alt-s', run: () => { actions.current?.saveAll(); return true } },
  ], [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || !actions.current) return
      const mod = IS_MAC ? event.metaKey : event.ctrlKey
      if (mod && event.code === 'KeyS') {
        event.preventDefault()
        if (event.altKey) actions.current.saveAll()
        else actions.current.save()
      } else if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyW') {
        event.preventDefault()
        actions.current.close()
      } else if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        actions.current.cycle(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (activePath) setSelectedId(activePath)
  }, [activePath, setSelectedId])

  const seenFile = useRef()
  const seenActive = useRef()
  useEffect(() => {
    const fileChanged = file !== seenFile.current
    const activeChanged = activePath !== seenActive.current
    seenFile.current = file
    seenActive.current = activePath
    if (fileChanged && file && file !== activePath) {
      files.open(file)
      tree.expand(parentOf(file))
      return
    }
    if (fileChanged && file) tree.expand(parentOf(file))
    if (activeChanged && (activePath || null) !== (file || null)) onFileChange(activePath || null)
  }, [file, activePath, files.open, tree.expand, onFileChange])

  const lastReady = useRef(null)
  useEffect(() => {
    if (isReady(activeTab)) lastReady.current = activeTab.path
  })
  const editorTab = isReady(activeTab)
    ? activeTab
    : tabs.find((tab) => tab.path === lastReady.current && isReady(tab)) || null
  const showEditor = Boolean(editorTab) && editorTab === activeTab
  const activeMedia = activeTab && !activeTab.loading && !activeTab.error && activeTab.binary
    ? mediaFor(activeTab.name)
    : null
  const docIdsKey = tabs.filter(isReady).map((tab) => tab.path).join('\n')
  const docIds = useMemo(() => (docIdsKey ? docIdsKey.split('\n') : []), [docIdsKey])
  const activeDirty = Boolean(activeTab) && isDirty(activeTab)

  const confirmDiscard = (message) => !files.anyDirty || window.confirm(message)

  const leave = () => {
    if (confirmDiscard('You have unsaved changes. Leave the editor and discard them?')) onBack()
  }

  const workspaceOptions = workspaces.length
    ? workspaces.map((item) => ({ value: item.id, displayValue: item.name }))
    : [{ value: '', displayValue: 'Base directory' }]

  const switchWorkspace = (value) => {
    const next = workspaces.find((item) => item.id.toLowerCase() === value)
    if (!next || next.id === workspaceId) return
    if (confirmDiscard('You have unsaved changes. Switch workspace and discard them?')) onSelectWorkspace(next.id)
  }

  const sidebar = (
    <DevScope id="kgyxz59" state={{ expanded: tree.expandedIds.length, loaded: Boolean(tree.childrenByPath['']), creating: explorer.pending?.type || null }}>
      <aside className="explorer">
        <div className="explorer__title">Explorer</div>
        <div className="explorer__header">
          <span className="explorer__root" title={root}>{rootName}</span>
          <div className="explorer__actions">
            <Button devId="k7fd4l9" variant="ghost" size="sm" title="New File…" aria-label="New File" onClick={() => explorer.startCreate('file')}>
              <Icon d={ICONS.newFile} />
            </Button>
            <Button devId="g2n91yb" variant="ghost" size="sm" title="New Folder…" aria-label="New Folder" onClick={() => explorer.startCreate('dir')}>
              <Icon d={ICONS.newFolder} />
            </Button>
            <Button devId="xyn6dbq" variant="ghost" size="sm" title="Refresh Explorer" aria-label="Refresh Explorer" onClick={() => explorer.refresh(null)}>
              <Icon d={ICONS.refresh} />
            </Button>
            <Button devId="4q1hpo6" variant="ghost" size="sm" title="Collapse Folders in Explorer" aria-label="Collapse All" onClick={tree.collapseAll}>
              <Icon d={ICONS.collapse} />
            </Button>
          </div>
        </div>
        <FileSearch
          devId="m4k9p2c"
          workspaceId={workspaceId}
          onOpen={(path, line, column) => {
            files.open(path)
            setReveal({ path, line, column, token: Date.now() })
          }}
        >
          <div className="explorer__tree">
            <FileTree devId="ipx3il6" tree={tree} explorer={explorer} files={files} />
          </div>
        </FileSearch>
      </aside>
    </DevScope>
  )

  const main = (
    <DevScope id="ag98pkk" state={{ active: activePath, tabs: tabs.length, dirty: activeDirty, ready: showEditor }}>
      <section className="editor-main">
        {tabs.length > 0 && (
          <TabStrip
            devId="1eemwov"
            orientation="horizontal"
            items={tabItems(tabs)}
            activeId={activePath}
            select={files.activate}
            close={files.close}
            closeAll={files.closeAll}
          />
        )}
        <div className="editor-main__body">
          {editorTab && (
            <div className={`editor-main__code${showEditor ? '' : ' editor-main__code--hidden'}`}>
              <CodeEditor
                devId="0vrzepu"
                docId={editorTab.path}
                value={editorTab.content}
                filename={editorTab.name}
                docIds={docIds}
                keys={keys}
                onChange={(value, docId) => files.update(docId, value)}
                onCursorChange={setCursor}
                reveal={showEditor && reveal && reveal.path === editorTab.path
                  ? { line: reveal.line, column: reveal.column, token: reveal.token }
                  : null}
                className="editor-main__codemirror"
              />
            </div>
          )}
          {!activeTab && <EmptyState />}
          {activeTab && !isReady(activeTab) && (
            <FileMessage tab={activeTab} workspaceId={workspaceId} onRetry={() => files.open(activeTab.path)} />
          )}
        </div>
      </section>
    </DevScope>
  )

  return (
    <DevScope id={devId} state={{ workspace: workspaceId, active: activePath, tabs: tabs.length, dirty: files.anyDirty }}>
      <div className="editor-view">
        <DevScope id="kir1dhp" state={{ workspace: workspaceId, dirty: files.anyDirty }}>
          <header className="editor-topbar">
            <Button devId="9owgsdb" variant="secondary" size="sm" onClick={leave}>
              ← Sessions
            </Button>
            <div className="editor-topbar__title">
              <strong>{workspace?.name || 'Base directory'}</strong>
              <span className="editor-topbar__root" title={root}>{root}</span>
            </div>
            <DevScope id="sknbs9s" state={{ workspace: workspaceId, count: workspaces.length }}>
              <SelectDisplay
                className="editor-topbar__workspace"
                aria-label="Workspace"
                selected={(workspaceId || '').toLowerCase()}
                options={workspaceOptions}
                select={switchWorkspace}
                disabled={workspaces.length === 0}
              />
            </DevScope>
          </header>
        </DevScope>
        <div className="editor-view__main">
          <SplitPane
            devId="tsmyejb"
            direction="horizontal"
            defaultSize={260}
            minSize={170}
            maxSize={640}
            storageKey="harness.editor.sidebarWidth"
          >
            {sidebar}
            {main}
          </SplitPane>
        </div>
        <StatusBar devId="t3bwsvw">
          <StatusBarItem align="left" title={activeTab ? absolutePath(root, activeTab.path) : root}>
            {activeTab ? activeTab.path : rootName}
          </StatusBarItem>
          {activeTab?.saving && <StatusBarItem align="left">Saving…</StatusBarItem>}
          {activeDirty && !activeTab.saving && (
            <StatusBarItem align="left" title={`Save (${MOD}+S)`} onClick={() => files.save(activeTab.path)}>
              ● unsaved
            </StatusBarItem>
          )}
          {activeTab?.saveError && (
            <StatusBarItem align="left" title={activeTab.saveError}>
              <span className="editor-status__error">⚠ {activeTab.saveError}</span>
            </StatusBarItem>
          )}
          {showEditor && (
            <StatusBarItem align="right">
              Ln {cursor.line}, Col {cursor.col}{cursor.selected ? ` (${cursor.selected} selected)` : ''}
            </StatusBarItem>
          )}
          {showEditor && <StatusBarItem align="right">{languageFor(activeTab.name)}</StatusBarItem>}
          {activeMedia && <StatusBarItem align="right">{formatSize(activeTab.size)}</StatusBarItem>}
          {activeMedia && <StatusBarItem align="right">{MEDIA_LABELS[activeMedia]}</StatusBarItem>}
          {showEditor && <StatusBarItem align="right">UTF-8</StatusBarItem>}
          <StatusBarItem align="right" title={root}>
            <span className="editor-status__root">{root}</span>
          </StatusBarItem>
        </StatusBar>
      </div>
    </DevScope>
  )
}

export default EditorView
