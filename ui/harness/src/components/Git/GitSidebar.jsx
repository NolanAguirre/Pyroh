import { Button, DevScope, Fold, FoldContent, FoldTrigger, FormToggle } from 'component-library'
import FileGroup from './FileGroup'
import Icon, { ICONS } from './GitIcon'
import { IS_MAC, MOD, formatAgo } from './gitFormat'

const GitSidebar = ({
  repo,
  status,
  busy,
  stagedFiles,
  changedFiles,
  files,
  selection,
  message,
  setMessage,
  amend,
  setAmend,
  canCommit,
  conflicted,
  commits,
  select,
  confirmDiscard,
  submitCommit,
}) => (
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

export default GitSidebar
