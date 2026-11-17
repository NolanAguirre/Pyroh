import { memo, useEffect, useRef, useState } from 'react'
import { Badge, DevScope, ScrollingText } from 'component-library'
import { ChevronIcon, PinIcon, RestoreIcon, TrashIcon } from './icons'
import { formatCompactNumber, formatDuration } from '../../format'

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  error: 'danger',
  queued: 'info',
  subagent: 'primary',
}

const interactionVariant = (provider, model, elapsedMs) => {
  const providerName = (provider || '').toLowerCase()
  const modelName = (model || '').toLowerCase()
  if (providerName === 'claude' || providerName === 'codex'
    || (providerName === 'cursor' && /^gpt(?:[-\s]|$)/.test(modelName))) {
    if (elapsedMs >= 30 * 60 * 1000) return 'danger'
    if (elapsedMs >= 28 * 60 * 1000) return 'warning'
    return 'success'
  }
  if (providerName === 'cursor') {
    if (/^(?:claude|opus|sonnet|haiku)(?:[-\s]|$)/.test(modelName)) {
      if (elapsedMs >= 5 * 60 * 1000) return 'danger'
      if (elapsedMs >= 4 * 60 * 1000) return 'warning'
      return 'success'
    }
    if (/^grok(?:[-\s]|$)/.test(modelName)) {
      return elapsedMs > 3 * 60 * 1000 ? 'danger' : 'success'
    }
  }
  return 'neutral'
}

const LastInteraction = memo(({ timestamp, provider, model }) => {
  const baseMs = timestamp ? Date.parse(timestamp) : NaN
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(baseMs)) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [baseMs])

  if (!Number.isFinite(baseMs)) return null

  const elapsedMs = Math.max(0, now - baseMs)
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const baseDate = new Date(baseMs)
  const label = elapsedMs >= 60 * 60 * 1000
    ? baseDate.toLocaleDateString()
    : `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
  const variant = interactionVariant(provider, model, elapsedMs)
  const description = `Last chat interaction: ${baseDate.toLocaleString()}`

  return (
    <time
      className={`session-row__interaction session-row__interaction--${variant}`}
      dateTime={timestamp}
      title={description}
      aria-label={description}
    >
      {label}
    </time>
  )
})

const SessionRow = memo(({
  session,
  active,
  onSelect,
  onRename,
  onArchive,
  archiveBusy,
  onPin,
  pinBusy,
  hasChildren = false,
  collapsed = false,
  onToggleCollapsed,
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const skipCommit = useRef(false)

  const startEdit = (event) => {
    event.stopPropagation()
    skipCommit.current = false
    setDraft(session.name || '')
    setError('')
    setEditing(true)
  }

  const cancelEdit = (event) => {
    event.preventDefault()
    skipCommit.current = true
    setDraft(session.name || '')
    setError('')
    setEditing(false)
  }

  const commit = async () => {
    if (skipCommit.current) {
      skipCommit.current = false
      return
    }
    const next = draft.trim()
    if (next === (session.name || '')) {
      setEditing(false)
      setError('')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onRename(session.id, next)
      setEditing(false)
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleArchiveClick = (event) => {
    event.stopPropagation()
    onArchive(session.id, !session.archived)
  }

  const handlePinClick = (event) => {
    event.stopPropagation()
    onPin(session.id, !session.pinned)
  }

  const handleCollapseClick = (event) => {
    event.stopPropagation()
    onToggleCollapsed(session.id)
  }

  const isLive = session.status === 'running' || session.status === 'awaiting_input'
  const isSubagent = Boolean(session.parentSessionId) && session.childKind !== 'fork'
  const tokenTotal = session.totals?.tokens?.total ?? 0
  const durationMs = session.totals?.durationMs || 0

  return (
    <DevScope id="hr1a5e8" state={{ session: session.id, active, editing, named: Boolean(session.name), pinned: Boolean(session.pinned) }}>
      <div
        className={`session-row${active ? ' session-row--active' : ''}${session.archived ? ' session-row--archived' : ''}${session.pinned ? ' session-row--pinned' : ''}`}
        onClick={() => onSelect(session.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(session.id)
        }}
      >
        <div className="session-row__top">
          {editing ? (
            <DevScope id="f3k8m2q" state={{ busy, error: Boolean(error) }}>
              <form
                className="session-row__name-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  commit()
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  className="text-input session-row__name-input"
                  value={draft}
                  aria-label="Session name"
                  placeholder="Session name"
                  autoFocus
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') cancelEdit(event)
                  }}
                  onBlur={commit}
                />
              </form>
            </DevScope>
          ) : (
            <div className="session-row__title-wrap">
              {hasChildren && !isSubagent && (
                <DevScope id="k8c3n5v" state={{ collapsed }}>
                  <button
                    type="button"
                    className={`session-row__edit-btn session-row__collapse-btn${collapsed ? ' session-row__collapse-btn--collapsed' : ''}`}
                    title={collapsed ? 'Show subagents' : 'Hide subagents'}
                    aria-label={collapsed ? 'Show subagents' : 'Hide subagents'}
                    aria-expanded={!collapsed}
                    onClick={handleCollapseClick}
                  >
                    <ChevronIcon />
                  </button>
                </DevScope>
              )}
              <DevScope id="q2n6w8r" state={{ pinned: Boolean(session.pinned) }}>
                <button
                  type="button"
                  className={`session-row__edit-btn session-row__pin-btn${session.pinned ? ' session-row__pin-btn--on' : ''}`}
                  title={session.pinned ? 'Unpin session' : 'Pin session'}
                  aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
                  aria-pressed={Boolean(session.pinned)}
                  disabled={pinBusy}
                  onClick={handlePinClick}
                >
                  <PinIcon filled={session.pinned} />
                </button>
              </DevScope>
              <DevScope id="w2s9f4j" state={{ named: Boolean(session.name) }}>
                <ScrollingText
                  animate="hover"
                  className={`session-row__name${session.name ? '' : ' session-row__name--empty'}`}
                  title={session.name || session.id}
                >
                  {session.name || 'Untitled session'}
                </ScrollingText>
              </DevScope>
              <DevScope id="i5a8p1o">
                <button
                  type="button"
                  className="session-row__edit-btn session-row__rename-btn"
                  title="Rename session"
                  aria-label="Rename session"
                  onClick={startEdit}
                >
                  ✎
                </button>
              </DevScope>
              {!isSubagent && (
                <DevScope id="p5t1m7k">
                  <button
                    type="button"
                    className={`session-row__edit-btn ${session.archived ? 'session-row__restore-btn' : 'session-row__trash-btn'}`}
                    title={session.archived ? 'Restore session' : 'Archive session'}
                    aria-label={session.archived ? 'Restore session' : 'Archive session'}
                    disabled={archiveBusy}
                    onClick={handleArchiveClick}
                  >
                    {session.archived ? <RestoreIcon /> : <TrashIcon />}
                  </button>
                </DevScope>
              )}
            </div>
          )}
          <DevScope id="l9d2h6e" state={{ status: session.status, live: isLive }}>
            <div className="session-row__top-right">
              {isLive && <span className="session-row__pulse" aria-hidden="true" />}
              <Badge size="small" variant={STATUS_VARIANT[session.status] || 'neutral'}>
                {session.status}
              </Badge>
            </div>
          </DevScope>
        </div>

        <DevScope id="z4n0t7u" state={{ provider: session.provider, model: session.model || '' }}>
          <div className="session-row__info">
            <span className="session-row__identity">
              <span className="session-row__provider">
                {session.provider}
                {session.model ? ` · ${session.model}` : ''}
              </span>
              {session.id && (
                <span className="session-row__id" title={session.id}>{session.id}</span>
              )}
            </span>
            <div className="session-row__meta">
              <LastInteraction timestamp={session.lastInteractionAt} provider={session.provider} model={session.model} />
              <span>{formatCompactNumber(tokenTotal)} tok</span>
              <span>{formatDuration(durationMs)}</span>
            </div>
          </div>
        </DevScope>

        {error && (
          <DevScope id="b6y1c9a">
            <p className="hint hint--error" role="alert">{error}</p>
          </DevScope>
        )}
      </div>
    </DevScope>
  )
})

export default SessionRow
