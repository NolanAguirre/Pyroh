import { CheckboxDisplay, DevScope } from 'component-library'

const RUN_AFTER_LIMIT = 5

export const eligibleRunAfterSessions = (sessions, sessionId) => (sessions || [])
  .filter((item) => item.id !== sessionId && (item.status === 'running' || item.status === 'awaiting_input'))
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(a.id).localeCompare(String(b.id)))
  .slice(0, RUN_AFTER_LIMIT)

const optionLabel = (session) => {
  const name = session.name || 'Untitled session'
  const detail = [session.provider, session.model].filter(Boolean).join(' / ')
  return detail ? `${name} · ${detail}` : name
}

const RunAfterControl = ({ sessions, checked, sessionId, onChecked, onSession }) => {
  const disabled = sessions.length === 0
  const on = checked && !disabled
  const selected = sessions.some((session) => session.id === sessionId) ? sessionId : ''

  return (
    <DevScope id="r2a8f6q" state={{ checked: on, disabled, sessionId: selected, count: sessions.length }}>
      <div className="composer__run-after">
        <CheckboxDisplay
          id="run-after"
          label="Run after"
          checked={on}
          toggle={() => onChecked(!on)}
          disabled={disabled}
          title={disabled ? 'No running session to wait for' : 'Run this prompt after another session'}
        />
        {on && (
          <select
            className="composer__run-after-select"
            value={selected}
            required
            aria-required="true"
            aria-label="Session to run after"
            onChange={(event) => onSession(event.target.value)}
          >
            <option value="">Select a session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>{optionLabel(session)}</option>
            ))}
          </select>
        )}
      </div>
    </DevScope>
  )
}

export default RunAfterControl
