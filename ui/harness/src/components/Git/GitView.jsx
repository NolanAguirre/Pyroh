import { useEffect, useMemo, useRef, useState } from 'react'
import { DevScope, SplitPane } from 'component-library'
import useGitRepo from './useGitRepo'
import '../Editor/Editor.css'
import './Git.css'
import DiffPane from './DiffPane'
import GitSidebar from './GitSidebar'
import GitStatusBar from './GitStatusBar'
import GitTopbar from './GitTopbar'

const GitView = ({ devId, workspaces = [], workspace, workspaceId, file = null, onFileChange, onSelectWorkspace, onOpenFile, onBack }) => {
  const repo = useGitRepo(workspaceId)
  const { status, branches, commits, busy } = repo
  const [selection, setSelection] = useState(null)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)

  const files = useMemo(() => status?.files || [], [status])
  const stagedFiles = useMemo(() => files.filter((item) => item.index && !item.conflicted), [files])
  const changedFiles = useMemo(() => files.filter((item) => item.worktree || item.conflicted), [files])
  const conflicted = changedFiles.some((item) => item.conflicted)

  const restored = useRef(false)

  useEffect(() => {
    restored.current = false
    setSelection(null)
    setMessage('')
    setAmend(false)
  }, [workspaceId])

  useEffect(() => {
    if (!status) return
    const first = !restored.current
    restored.current = true
    if (!file || (selection && selection.path === file)) return
    const inStaged = stagedFiles.some((item) => item.path === file)
    const inChanged = changedFiles.some((item) => item.path === file)
    if (inChanged || inStaged) setSelection({ path: file, staged: !inChanged })
    else if (first) onFileChange(null)
  }, [status, file])

  useEffect(() => {
    if (!selection || !status) return
    const list = selection.staged ? stagedFiles : changedFiles
    if (list.some((item) => item.path === selection.path)) return
    const other = selection.staged ? changedFiles : stagedFiles
    if (other.some((item) => item.path === selection.path)) setSelection({ path: selection.path, staged: !selection.staged })
    else setSelection(null)
  }, [status])

  useEffect(() => {
    if (!restored.current) return
    const next = selection ? selection.path : null
    if ((file || null) !== next) onFileChange(next)
  }, [selection])

  const selectedFile = selection
    ? (selection.staged ? stagedFiles : changedFiles).find((item) => item.path === selection.path) || null
    : null
  const statusKey = selectedFile ? repo.version : 0

  const select = (item, staged) => setSelection({ path: item.path, staged })

  const confirmDiscard = (paths) => {
    const untracked = paths.filter((p) => changedFiles.some((item) => item.path === p && item.untracked))
    const label = paths.length === 1 ? `"${paths[0]}"` : `${paths.length} files`
    const extra = untracked.length ? ' Untracked files will be deleted.' : ''
    if (window.confirm(`Discard changes to ${label}? This cannot be undone.${extra}`)) repo.discard(paths)
  }

  const canCommit = !busy && !conflicted && (amend || (stagedFiles.length > 0 && message.trim()))
  const submitCommit = async () => {
    if (!canCommit) return
    const result = await repo.commit(message, amend)
    if (result) {
      setMessage('')
      setAmend(false)
    }
  }

  const hasRemote = Boolean(status?.remotes?.length)
  const ahead = status?.ahead || 0
  const behind = status?.behind || 0
  const root = status?.root || workspace?.cwd || ''

  const sidebar = (
    <GitSidebar
      repo={repo}
      status={status}
      busy={busy}
      stagedFiles={stagedFiles}
      changedFiles={changedFiles}
      files={files}
      selection={selection}
      message={message}
      setMessage={setMessage}
      amend={amend}
      setAmend={setAmend}
      canCommit={canCommit}
      conflicted={conflicted}
      commits={commits}
      select={select}
      confirmDiscard={confirmDiscard}
      submitCommit={submitCommit}
    />
  )

  const main = (
    <DiffPane
      workspaceId={workspaceId}
      selection={selection}
      file={selectedFile}
      statusKey={statusKey}
      busy={busy}
      onStage={repo.stage}
      onUnstage={repo.unstage}
      onOpenFile={onOpenFile}
    />
  )

  const body = repo.loading ? (
    <DevScope id="73kl63q">
      <div className="git-diff__empty"><p className="hint">Loading repository…</p></div>
    </DevScope>
  ) : repo.notRepo ? (
    <DevScope id="tgdajd8">
      <div className="git-diff__empty">
        <p className="git-diff__empty-title">This workspace is not a git repository</p>
        <p className="hint">{root}</p>
      </div>
    </DevScope>
  ) : (
    <SplitPane
      devId="pra61ku"
      direction="horizontal"
      defaultSize={320}
      minSize={220}
      maxSize={640}
      storageKey="harness.git.sidebarWidth"
      stackBelow={768}
    >
      {sidebar}
      {main}
    </SplitPane>
  )

  return (
    <DevScope id={devId} state={{ workspace: workspaceId, selected: selection?.path || null, staged: stagedFiles.length, changed: changedFiles.length }}>
      <div className="editor-view git-view">
        <GitTopbar
          workspaceId={workspaceId}
          workspace={workspace}
          workspaces={workspaces}
          status={status}
          branches={branches}
          busy={busy}
          root={root}
          hasRemote={hasRemote}
          ahead={ahead}
          behind={behind}
          onBack={onBack}
          onSelectWorkspace={onSelectWorkspace}
          repo={repo}
        />
        <div className="editor-view__main">{body}</div>
        <GitStatusBar
          status={status}
          ahead={ahead}
          behind={behind}
          busy={busy}
          conflicted={conflicted}
          stagedFiles={stagedFiles}
          changedFiles={changedFiles}
          root={root}
        />
      </div>
    </DevScope>
  )
}

export default GitView
