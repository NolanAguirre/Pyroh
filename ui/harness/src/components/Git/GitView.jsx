import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  CodeDiff,
  DevScope,
  FileIcon,
  Fold,
  FoldContent,
  FoldTrigger,
  FormToggle,
  Popup,
  SelectDisplay,
  SplitPane,
  StatusBar,
  StatusBarItem,
} from 'component-library'
import api from '../../api'
import useGitRepo from './useGitRepo'
import { baseName, parentOf } from '../Editor/paths'
import '../Editor/Editor.css'
import './Git.css'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const ICONS = {
  stage: 'M8 3.5v9M3.5 8h9',
  unstage: 'M3.5 8h9',
  discard: 'M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6M3 6.5 5.5 4M3 6.5 5.5 9',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3',
  open: 'M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9.5 1.5zM9.5 1.5V5H13',
}

const Icon = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const STATUS_LABEL = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Untracked',
  '!': 'Conflict',
}

const letterFor = (file, staged) => {
  if (file.conflicted) return '!'
  if (staged) return file.index
  return file.untracked ? 'U' : file.worktree
}

const sameSelection = (a, b) => Boolean(a) && Boolean(b) && a.path === b.path && a.staged === b.staged

const formatAgo = (ms) => {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

const FileRow = ({ file, staged, selected, busy, onSelect, onStage, onUnstage, onDiscard }) => {
  const letter = letterFor(file, staged)
  const dir = parentOf(file.path)
  return (
    <div
      className={`git-file${selected ? ' git-file--selected' : ''}`}
      role="button"
      tabIndex={0}
      title={`${file.origPath ? `${file.origPath} → ` : ''}${file.path} — ${STATUS_LABEL[letter] || letter}`}
      onClick={() => onSelect(file, staged)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(file, staged)
      }}
    >
      <FileIcon name={baseName(file.path)} size={14} />
      <span className="git-file__name">{baseName(file.path)}</span>
      {dir && <span className="git-file__dir">{dir}</span>}
      <span className="git-file__actions" onClick={(event) => event.stopPropagation()}>
        {staged ? (
          <button type="button" className="git-icon-btn" title="Unstage Changes" aria-label="Unstage" disabled={busy} onClick={() => onUnstage([file.path])}>
            <Icon d={ICONS.unstage} />
          </button>
        ) : (
          <>
            <button type="button" className="git-icon-btn" title="Discard Changes" aria-label="Discard" disabled={busy} onClick={() => onDiscard([file.path])}>
              <Icon d={ICONS.discard} />
            </button>
            <button type="button" className="git-icon-btn" title="Stage Changes" aria-label="Stage" disabled={busy} onClick={() => onStage([file.path])}>
              <Icon d={ICONS.stage} />
            </button>
          </>
        )}
      </span>
      <span className={`git-file__status git-file__status--${letter === '!' ? 'conflict' : letter}`}>{letter}</span>
    </div>
  )
}

const FileGroup = ({ devId, title, files, staged, selection, busy, actions, onSelect, onStage, onUnstage, onDiscard }) => (
  <DevScope id={devId} state={{ staged, count: files.length }}>
    <section className="git-group">
      <header className="git-group__header">
        <span className="git-group__title">{title}</span>
        <span className="git-group__actions">{actions}</span>
        <Badge size="small" variant="neutral" count={files.length} showZero />
      </header>
      <div className="git-group__list">
        {files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            staged={staged}
            selected={sameSelection(selection, { path: file.path, staged })}
            busy={busy}
            onSelect={onSelect}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
        ))}
      </div>
    </section>
  </DevScope>
)

const NewBranchForm = ({ devId, popup, current, busy, onCreate }) => {
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const branch = name.trim()
    if (!branch) return
    const result = await onCreate(branch, startPoint.trim())
    if (result && popup && popup.close) {
      setName('')
      setStartPoint('')
      popup.close()
    }
  }

  return (
    <DevScope id={devId} state={{ busy: Boolean(busy) }}>
      <form className="new-session" onSubmit={submit}>
        <div className="new-session__header">
          <h2>New Branch</h2>
          <p className="hint">Creates the branch and switches to it. Uncommitted changes come along.</p>
        </div>
        <DevScope id="6u9kgy3">
          <label className="field">
            <span className="field__label">Branch name</span>
            <input
              className="text-input"
              value={name}
              autoFocus
              placeholder="feature/my-change"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </DevScope>
        <DevScope id="jfgv8t6">
          <label className="field">
            <span className="field__label">Start from</span>
            <input
              className="text-input"
              value={startPoint}
              placeholder={current ? `${current} (current)` : 'HEAD'}
              onChange={(event) => setStartPoint(event.target.value)}
            />
          </label>
        </DevScope>
        <div className="new-session__actions">
          {popup && (
            <Button devId="xfas6fn" variant="ghost" size="sm" type="button" onClick={() => popup.close()}>
              Cancel
            </Button>
          )}
          <Button devId="og76ww7" variant="primary" type="submit" loading={busy === 'checkout'} disabled={!name.trim()}>
            Create Branch
          </Button>
        </div>
      </form>
    </DevScope>
  )
}

const DiffPane = ({ workspaceId, selection, file, statusKey, busy, onStage, onUnstage, onOpenFile }) => {
  const [diff, setDiff] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const selectionKey = selection ? `${selection.staged ? 's' : 'w'}:${selection.path}` : ''
  const origPath = file?.origPath || ''

  useEffect(() => {
    setDiff(null)
    setError(null)
  }, [selectionKey, workspaceId])

  useEffect(() => {
    if (!selection) return undefined
    const controller = new AbortController()
    setLoading(true)
    api.gitDiff(workspaceId, { path: selection.path, origPath: selection.staged ? origPath : '', staged: selection.staged }, { signal: controller.signal })
      .then((next) => {
        setDiff((prev) => (prev && prev.original === next.original && prev.modified === next.modified && prev.binary === next.binary ? prev : next))
        setError(null)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, selectionKey, origPath, statusKey])

  if (!selection) {
    return (
      <DevScope id="l5bhneg">
        <div className="git-diff__empty">
          <p className="git-diff__empty-title">Select a changed file to view its diff</p>
          <p className="hint">Staged files compare HEAD to the index. Unstaged files compare the index to the working tree.</p>
        </div>
      </DevScope>
    )
  }

  return (
    <DevScope id="w5292nc" state={{ path: selection.path, staged: selection.staged, loading, binary: Boolean(diff?.binary) }}>
      <section className="git-diff">
        <header className="git-diff__header">
          <FileIcon name={baseName(selection.path)} size={14} />
          <span className="git-diff__path" title={selection.path}>
            {diff?.origPath && diff.origPath !== selection.path ? `${diff.origPath} → ` : ''}{selection.path}
          </span>
          <span className="git-diff__side">{selection.staged ? 'HEAD ↔ Index' : 'Index ↔ Working Tree'}</span>
          {loading && !diff && <span className="git-diff__loading">Loading…</span>}
          <div className="git-diff__actions">
            <Button devId="8jocmb6" variant="ghost" size="sm" title="Open in editor" onClick={() => onOpenFile(selection.path)} disabled={!onOpenFile || Boolean(diff?.deleted)}>
              <Icon d={ICONS.open} />
            </Button>
            {file && (selection.staged ? (
              <Button devId="5xz7d9u" variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => onUnstage([selection.path])}>
                Unstage
              </Button>
            ) : (
              <Button devId="uho0gqr" variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => onStage([selection.path])}>
                Stage
              </Button>
            ))}
          </div>
        </header>
        <div className="git-diff__body">
          {error && <p className="git-diff__message hint hint--error">{error}</p>}
          {!error && diff?.binary && <p className="git-diff__message hint">Binary file — no text diff available.</p>}
          {!error && diff?.tooLarge && <p className="git-diff__message hint">File is too large to diff here.</p>}
          {!error && diff && !diff.binary && !diff.tooLarge && (
            <CodeDiff
              devId="5sog16z"
              original={diff.original}
              modified={diff.modified}
              filename={baseName(selection.path)}
            />
          )}
        </div>
      </section>
    </DevScope>
  )
}

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

  const localOptions = branches.local.map((branch, index) => ({ value: `l${index}`, displayValue: branch.name, branch }))
  const remoteOnly = branches.remote.filter((remote) => {
    const short = remote.name.slice(remote.name.indexOf('/') + 1)
    return !branches.local.some((local) => local.name === short)
  })
  const remoteOptions = remoteOnly.map((branch, index) => ({ value: `r${index}`, displayValue: `${branch.name} (remote)`, branch }))
  const detachedOption = status && status.detached ? [{ value: 'detached', displayValue: `(detached ${String(status.oid || '').slice(0, 7)})` }] : []
  const branchOptions = [...detachedOption, ...localOptions, ...remoteOptions]
  const currentOption = status?.detached ? 'detached' : (localOptions.find((option) => option.branch.name === status?.branch)?.value || '')

  const switchBranch = (value) => {
    const option = branchOptions.find((item) => item.value === value)
    if (!option || !option.branch || option.value === currentOption) return
    const target = option.branch.ref.startsWith('refs/remotes/')
      ? option.branch.name.slice(option.branch.name.indexOf('/') + 1)
      : option.branch.name
    repo.checkout(target)
  }

  const workspaceOptions = workspaces.length
    ? workspaces.map((item) => ({ value: item.id, displayValue: item.name }))
    : [{ value: '', displayValue: 'Base directory' }]

  const switchWorkspace = (value) => {
    const next = workspaces.find((item) => item.id.toLowerCase() === value)
    if (next && next.id !== workspaceId) onSelectWorkspace(next.id)
  }

  const hasRemote = Boolean(status?.remotes?.length)
  const ahead = status?.ahead || 0
  const behind = status?.behind || 0
  const root = status?.root || workspace?.cwd || ''

  const topbar = (
    <DevScope id="9f1uqju" state={{ workspace: workspaceId, branch: status?.branch || null, busy: busy || null }}>
      <header className="editor-topbar git-topbar">
        <Button devId="g3xfcks" variant="secondary" size="sm" onClick={onBack}>
          ← Sessions
        </Button>
        <div className="editor-topbar__title">
          <strong>{workspace?.name || 'Base directory'}</strong>
          <span className="editor-topbar__root" title={root}>{root}</span>
        </div>
        {status && (
          <div className="git-topbar__branch">
            <DevScope id="8f1tz86" state={{ branch: status.branch || null, count: branchOptions.length }}>
              <SelectDisplay
                className="editor-topbar__workspace git-topbar__branch-select"
                aria-label="Branch"
                selected={currentOption}
                options={branchOptions}
                select={switchBranch}
                disabled={Boolean(busy)}
              />
            </DevScope>
            <Popup devId="4d3lhkv" panelClassName="new-session-panel">
              <NewBranchForm
                devId="ervsdf2"
                current={status.branch}
                busy={busy}
                onCreate={(name, startPoint) => repo.checkout(name, { create: true, startPoint: startPoint || undefined })}
              />
              <Button devId="kf57qnr" variant="secondary" size="sm" title="Create a new branch" disabled={Boolean(busy)}>
                + Branch
              </Button>
            </Popup>
          </div>
        )}
        {status && (
          <div className="git-topbar__sync">
            <Button devId="5t95o0v" variant="ghost" size="sm" title="Fetch from all remotes" loading={busy === 'fetch'} disabled={Boolean(busy) || !hasRemote} onClick={repo.fetchRemotes}>
              Fetch
            </Button>
            <Button devId="7di69ic" variant="secondary" size="sm" title="Pull (fast-forward only)" loading={busy === 'pull'} disabled={Boolean(busy) || !status.upstream} onClick={repo.pull}>
              Pull{behind ? ` ↓${behind}` : ''}
            </Button>
            <Button
              devId="bzzdqr8"
              variant={ahead || (!status.upstream && status.branch) ? 'primary' : 'secondary'}
              size="sm"
              title={status.upstream ? `Push to ${status.upstream}` : 'Publish branch to remote'}
              loading={busy === 'push'}
              disabled={Boolean(busy) || !hasRemote || !status.branch}
              onClick={repo.push}
            >
              {status.upstream ? `Push${ahead ? ` ↑${ahead}` : ''}` : 'Publish'}
            </Button>
          </div>
        )}
        <DevScope id="pbi9d8j" state={{ workspace: workspaceId, count: workspaces.length }}>
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
  )

  const sidebar = (
    <DevScope id="o9kv168" state={{ staged: stagedFiles.length, changed: changedFiles.length, amend }}>
      <aside className="git-panel">
        <div className="git-panel__title">
          <span>Source Control</span>
          <button type="button" className="git-icon-btn" title="Refresh" aria-label="Refresh" onClick={repo.refresh}>
            <Icon d={ICONS.refresh} />
          </button>
        </div>
        <DevScope id="z1qksh8" state={{ canCommit: Boolean(canCommit), amend }}>
          <div className="git-commit">
            <textarea
              className="text-input git-commit__message"
              value={message}
              rows={3}
              placeholder={`Message (${MOD}+Enter to commit on "${status?.branch || 'HEAD'}")`}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((IS_MAC ? event.metaKey : event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  submitCommit()
                }
              }}
            />
            <div className="git-commit__row">
              <label className="git-commit__amend">
                <FormToggle field={{ value: amend, onChange: (event) => setAmend(event.target.checked) }} />
                <span>Amend</span>
              </label>
              <Button
                devId="hj1za4j"
                variant="primary"
                size="sm"
                loading={busy === 'commit'}
                disabled={!canCommit}
                title={conflicted ? 'Resolve conflicts first' : stagedFiles.length || amend ? 'Commit staged changes' : 'Stage changes to commit'}
                onClick={submitCommit}
              >
                {amend ? 'Amend Commit' : 'Commit'}
              </Button>
            </div>
          </div>
        </DevScope>
        {repo.error && (
          <DevScope id="zg5nuct">
            <div className="git-notice git-notice--error" role="alert">
              <pre>{repo.error}</pre>
              <button type="button" className="git-icon-btn" aria-label="Dismiss" onClick={repo.clearError}>×</button>
            </div>
          </DevScope>
        )}
        {repo.output && !repo.error && (
          <DevScope id="k8ocvq0">
            <div className="git-notice">
              <pre>{repo.output}</pre>
              <button type="button" className="git-icon-btn" aria-label="Dismiss" onClick={repo.clearOutput}>×</button>
            </div>
          </DevScope>
        )}
        <div className="git-panel__groups">
          {stagedFiles.length > 0 && (
            <FileGroup
              devId="nsoc2wk"
              title="Staged Changes"
              files={stagedFiles}
              staged
              selection={selection}
              busy={Boolean(busy)}
              onSelect={select}
              onStage={repo.stage}
              onUnstage={repo.unstage}
              onDiscard={confirmDiscard}
              actions={(
                <button type="button" className="git-icon-btn" title="Unstage All Changes" aria-label="Unstage all" disabled={Boolean(busy)} onClick={() => repo.unstage([])}>
                  <Icon d={ICONS.unstage} />
                </button>
              )}
            />
          )}
          <FileGroup
            devId="yjfcln9"
            title="Changes"
            files={changedFiles}
            staged={false}
            selection={selection}
            busy={Boolean(busy)}
            onSelect={select}
            onStage={repo.stage}
            onUnstage={repo.unstage}
            onDiscard={confirmDiscard}
            actions={changedFiles.length > 0 && (
              <>
                <button type="button" className="git-icon-btn" title="Discard All Changes" aria-label="Discard all" disabled={Boolean(busy)} onClick={() => confirmDiscard(changedFiles.map((item) => item.path))}>
                  <Icon d={ICONS.discard} />
                </button>
                <button type="button" className="git-icon-btn" title="Stage All Changes" aria-label="Stage all" disabled={Boolean(busy)} onClick={() => repo.stage([])}>
                  <Icon d={ICONS.stage} />
                </button>
              </>
            )}
          />
          {status && files.length === 0 && (
            <DevScope id="86yja3n">
              <p className="hint git-panel__clean">Working tree clean.</p>
            </DevScope>
          )}
          <DevScope id="xutxqip" state={{ count: commits.length }}>
            <div className="git-history">
              <Fold>
                <FoldTrigger>Recent Commits ({commits.length})</FoldTrigger>
                <FoldContent>
                  <ul className="git-history__list">
                    {commits.map((item) => (
                      <li key={item.hash} className="git-history__item" title={`${item.hash}\n${item.author}`}>
                        <span className="git-history__subject">{item.subject}</span>
                        <span className="git-history__meta">
                          <code>{item.short}</code> · {item.author} · {formatAgo(item.date)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </FoldContent>
              </Fold>
            </div>
          </DevScope>
        </div>
      </aside>
    </DevScope>
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
        {topbar}
        <div className="editor-view__main">{body}</div>
        <StatusBar devId="e8wby19">
          <StatusBarItem align="left" title={status?.upstream ? `Tracking ${status.upstream}` : 'No upstream'}>
            ⑂ {status?.branch || (status?.detached ? 'detached' : '—')}
          </StatusBarItem>
          {status?.upstream && (
            <StatusBarItem align="left">↑{ahead} ↓{behind}</StatusBarItem>
          )}
          {busy && <StatusBarItem align="left">{busy}…</StatusBarItem>}
          {conflicted && (
            <StatusBarItem align="left">
              <span className="editor-status__error">Merge conflicts</span>
            </StatusBarItem>
          )}
          <StatusBarItem align="right">{stagedFiles.length} staged · {changedFiles.length} changed</StatusBarItem>
          <StatusBarItem align="right" title={root}>
            <span className="editor-status__root">{root}</span>
          </StatusBarItem>
        </StatusBar>
      </div>
    </DevScope>
  )
}

export default GitView
