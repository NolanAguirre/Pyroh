import { useEffect, useState } from 'react'
import { Button, CodeDiff, DevScope, FileIcon } from 'component-library'
import api from '../../api'
import { baseName } from '../Editor/paths'
import Icon, { ICONS } from './GitIcon'

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

export default DiffPane
