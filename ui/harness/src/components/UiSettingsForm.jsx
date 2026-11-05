import { useEffect, useState } from 'react'
import { DevScope, FormRange, FormToggle } from 'component-library'
import api from '../api'

const MIN_TRANSCRIPT_FONT_SIZE = 12
const MAX_TRANSCRIPT_FONT_SIZE = 24

const UiSettingsForm = ({ devId, transcriptFontSize, onTranscriptFontSize, maxSubagentDepth, onMaxSubagentDepth, error }) => {
  const [spellcheck, setSpellcheck] = useState(null)
  // Whether the categorizer is configured, and the saved on/off choice.
  const [namingAvailable, setNamingAvailable] = useState(null)
  const [sessionNaming, setSessionNaming] = useState(true)
  const [namingError, setNamingError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .getConfig()
      .then((body) => {
        if (cancelled) return
        setSpellcheck(Boolean(body && body.spellcheck))
        setNamingAvailable(Boolean(body && body.sessionNaming))
      })
      .catch(() => {
        if (!cancelled) {
          setSpellcheck(null)
          setNamingAvailable(null)
        }
      })
    api
      .getUiSettings()
      .then(({ settings }) => {
        if (!cancelled && settings && typeof settings.sessionNaming === 'boolean') setSessionNaming(settings.sessionNaming)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const spellcheckLabel = spellcheck == null ? 'Unknown' : spellcheck ? 'On' : 'Off'

  const changeSessionNaming = (next) => {
    const previous = sessionNaming
    setSessionNaming(next)
    setNamingError('')
    api.setUiSettings({ sessionNaming: next }).catch((err) => {
      setSessionNaming(previous)
      setNamingError(err && err.message ? err.message : String(err))
    })
  }

  return (
    <DevScope id={devId} state={{ transcriptFontSize, maxSubagentDepth, spellcheck, namingAvailable, sessionNaming }}>
      <form className="ui-settings" onSubmit={(event) => event.preventDefault()}>
        <div className="ui-settings__header">
          <h2>Settings</h2>
          <p className="hint">Global settings are saved on disk.</p>
        </div>
        <DevScope id="p4c8n2s" state={{ spellcheck }}>
          <p className="field">
            <span className="field__label">Spellcheck</span>
            <span>{spellcheckLabel}</span>
          </p>
        </DevScope>
        <DevScope id="s5k9w3m" state={{ namingAvailable, sessionNaming }}>
          <label className="field">
            <span className="field__label">Session naming</span>
            <FormToggle
              aria-label="Session naming"
              disabled={!namingAvailable}
              field={{ value: sessionNaming, onChange: (event) => changeSessionNaming(event.target.checked) }}
            />
            {namingAvailable === false ? <span className="hint">Categorizer is not running.</span> : null}
          </label>
        </DevScope>
        <DevScope id="d8w1j4r" state={{ transcriptFontSize }}>
          <label className="field">
            <span className="field__label">Transcript and prompt text size</span>
            <FormRange
              min={MIN_TRANSCRIPT_FONT_SIZE}
              max={MAX_TRANSCRIPT_FONT_SIZE}
              step={1}
              aria-label="Transcript and prompt text size"
              field={{
                name: 'transcriptFontSize',
                value: transcriptFontSize,
                onChange: (event) => onTranscriptFontSize(event.target.value),
              }}
            />
          </label>
        </DevScope>
        <DevScope id="q6n2s8d" state={{ maxSubagentDepth }}>
          <label className="field">
            <span className="field__label">Maximum subagent depth: {maxSubagentDepth}</span>
            <FormRange
              min={0}
              max={10}
              step={1}
              aria-label="Maximum subagent depth"
              field={{
                name: 'maxSubagentDepth',
                value: maxSubagentDepth,
                onChange: (event) => onMaxSubagentDepth(event.target.value),
              }}
            />
            <span className="hint">Root depth is 0. Limit 0 disables delegation; 1 allows children; 2 lets children delegate once.</span>
          </label>
        </DevScope>
        {namingError ? <p className="hint hint--error" role="alert">{namingError}</p> : null}
        {error ? <p className="hint hint--error" role="alert">{error}</p> : null}
      </form>
    </DevScope>
  )
}

export default UiSettingsForm
