import { Button, DevScope } from 'component-library'

// Modes come from the registry. These DevScope ids belong to built-in mode
// buttons; plugin modes share pm6t3qz.
const MODE_SCOPES = { agent: 'hr0m6j9', ask: 'k3w9a5t', plan: 'hr4n8d2', decompose: 'hr5k1w7' }
const MODE_DEV_IDS = { 'token-waste': 'q7m2z9k', 'new-chat': 'n4c8x2e' }

const ModeToggle = ({ modes, mode, onChange, disabled }) => (
  <div className="mode-toggle" role="group" aria-label="Session mode">
    {modes.map((item) => {
      const isActive = mode === item.id
      if (item.scope !== 'builtin') {
        return (
          <DevScope key={item.id} id="pm6t3qz" state={{ mode: item.id, active: isActive }}>
            <button
              type="button"
              className={`mode-toggle__btn${isActive ? ' mode-toggle__btn--active' : ''}`}
              aria-pressed={isActive}
              title={item.hint || undefined}
              onClick={() => onChange(item.id)}
              disabled={disabled}
            >
              {item.label}
            </button>
          </DevScope>
        )
      }
      if (MODE_SCOPES[item.id]) {
        return (
          <DevScope key={item.id} id={MODE_SCOPES[item.id]} state={{ active: isActive }}>
            <button
              type="button"
              className={`mode-toggle__btn${isActive ? ' mode-toggle__btn--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onChange(item.id)}
              disabled={disabled}
            >
              {item.label}
            </button>
          </DevScope>
        )
      }
      return (
        <Button
          key={item.id}
          devId={MODE_DEV_IDS[item.id]}
          variant={isActive ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={isActive}
          onClick={() => onChange(item.id)}
          disabled={disabled}
        >
          {item.label}
        </Button>
      )
    })}
  </div>
)

export default ModeToggle
