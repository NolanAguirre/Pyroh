import { useEffect, useState } from 'react'
import { DevScope, FileIcon } from 'component-library'
import api from '../../api'
import { baseName, parentOf } from '../Editor/paths'
import { STATUS_LABEL, formatAgo } from './gitFormat'

const CommitFile = ({ file, selected, onSelect }) => {
  const dir = parentOf(file.path)
  return (
    <div
      className={`git-file git-file--commit${selected ? ' git-file--selected' : ''}`}
      role="button"
      tabIndex={0}
      title={`${file.origPath ? `${file.origPath} → ` : ''}${file.path} — ${STATUS_LABEL[file.status] || file.status}`}
      onClick={() => onSelect(file)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect(file)
      }}
    >
      <FileIcon name={baseName(file.path)} size={14} />
      <span className="git-file__name">{baseName(file.path)}</span>
      {dir && <span className="git-file__dir">{dir}</span>}
      <span className={`git-file__status git-file__status--${file.status}`}>{file.status}</span>
    </div>
  )
}

const CommitItem = ({ workspaceId, commit, selection, onSelect }) => {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || detail) return undefined
    const controller = new AbortController()
    api.gitCommitFiles(workspaceId, commit.hash, { signal: controller.signal })
      .then((next) => {
        setDetail(next)
        setError(null)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [open, workspaceId, commit.hash])

  const toggle = () => setOpen((value) => !value)

  const selectFile = (file) => onSelect({ path: file.path, origPath: file.origPath, staged: false, commit: commit.hash, short: commit.short })

  return (
    <DevScope id="xjk64u5" state={{ hash: commit.hash, open, files: detail ? detail.files.length : null }}>
      <li className={`git-history__item${open ? ' git-history__item--open' : ''}`}>
        <div
          className="git-history__summary"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          title={`${commit.hash}\n${commit.author}`}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') toggle()
          }}
        >
          <span className="git-history__subject">{commit.subject}</span>
          <span className="git-history__meta">
            <code>{commit.short}</code> · {commit.author} · {formatAgo(commit.date)}
          </span>
        </div>
        {open && (
          <div className="git-history__files">
            {detail?.body && <pre className="git-history__body">{detail.body}</pre>}
            {error && <p className="hint hint--error">{error}</p>}
            {!error && !detail && <p className="hint">Loading…</p>}
            {detail && detail.files.length === 0 && <p className="hint">No file changes.</p>}
            {detail && detail.files.map((file) => (
              <CommitFile
                key={file.path}
                file={file}
                selected={Boolean(selection) && selection.commit === commit.hash && selection.path === file.path}
                onSelect={selectFile}
              />
            ))}
          </div>
        )}
      </li>
    </DevScope>
  )
}

export default CommitItem
