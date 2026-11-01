import { Badge, Button, FolderIcon } from 'component-library'
import { Icon, ICONS } from './icons'

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  error: 'danger',
}

const SessionHeader = ({ session, status, isBusy, disconnected, busy, sideOpen, onPause, onResume, onStop, onToggleSide }) => (
  <header className="session-view__header">
    <div className="session-view__title">
      <Badge size="small" variant={STATUS_VARIANT[status] || 'neutral'}>{status}</Badge>
      <div className="session-view__headings">
        <div className="session-view__title-row">
          <span className="session-view__provider">
            {session.name ? `${session.name} · ` : ''}
            {session.provider}
            {session.model ? ` (${session.model})` : ''}
          </span>
          {session.codex?.reasoningEffort && (
            <Badge size="small" variant="neutral">{session.codex.reasoningEffort}</Badge>
          )}
          {session.grok?.reasoningEffort && (
            <Badge size="small" variant="neutral">{session.grok.reasoningEffort}</Badge>
          )}
          {session.claude?.reasoningEffort && (
            <Badge size="small" variant="neutral">{session.claude.reasoningEffort}</Badge>
          )}
        </div>
        <div className="session-view__paths">
          <span className="session-view__cwd" title={session.cwd}>
            <FolderIcon size={12} className="session-view__folder-icon" />
            {session.cwd}
          </span>
          {session.logPath && (
            <span className="session-view__path-sub" title={session.logPath}>
              log: {session.logPath}
            </span>
          )}
        </div>
      </div>
    </div>
    <div className="session-view__controls">
      <Button
        variant="secondary"
        size="sm"
        onClick={onPause}
        disabled={busy || !isBusy}
        devId="hr8c4n1"
        title="Pause"
        aria-label="Pause"
      >
        <Icon d={ICONS.pause} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onResume}
        disabled={busy || isBusy}
        devId="hr6p0s5"
        title={disconnected ? 'Reconnect and resume' : 'Resume'}
        aria-label={disconnected ? 'Reconnect and resume' : 'Resume'}
      >
        <Icon d={ICONS.resume} />
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={onStop}
        disabled={busy || status === 'stopped'}
        devId="hr3l7q9"
        title="Stop"
        aria-label="Stop"
      >
        <Icon d={ICONS.stop} />
      </Button>
      <Button
        variant={sideOpen ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onToggleSide}
        devId="h8w4c1x"
        title={sideOpen ? 'Collapse inspector' : 'Expand inspector'}
        aria-label={sideOpen ? 'Collapse inspector' : 'Expand inspector'}
      >
        <Icon d={ICONS.panel} />
      </Button>
    </div>
  </header>
)

export default SessionHeader
