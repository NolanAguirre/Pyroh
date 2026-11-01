import { Badge, DevScope, FileIcon } from 'component-library'
import { baseName, parentOf } from '../Editor/paths'
import Icon, { ICONS } from './GitIcon'
import { STATUS_LABEL, letterFor, sameSelection } from './gitFormat'

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

export default FileGroup
