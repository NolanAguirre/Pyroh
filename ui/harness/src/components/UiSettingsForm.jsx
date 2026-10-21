import { DevScope, FormRange } from 'component-library'

const MIN_TRANSCRIPT_FONT_SIZE = 12
const MAX_TRANSCRIPT_FONT_SIZE = 24

const UiSettingsForm = ({ devId, transcriptFontSize, onTranscriptFontSize, error }) => (
  <DevScope id={devId} state={{ transcriptFontSize }}>
    <form className="ui-settings" onSubmit={(event) => event.preventDefault()}>
      <div className="ui-settings__header">
        <h2>Settings</h2>
        <p className="hint">Transcript text size is saved on disk.</p>
      </div>
      <DevScope id="d8w1j4r" state={{ transcriptFontSize }}>
        <label className="field">
          <span className="field__label">Transcript text size</span>
          <FormRange
            min={MIN_TRANSCRIPT_FONT_SIZE}
            max={MAX_TRANSCRIPT_FONT_SIZE}
            step={1}
            aria-label="Transcript text size"
            field={{
              name: 'transcriptFontSize',
              value: transcriptFontSize,
              onChange: (event) => onTranscriptFontSize(event.target.value),
            }}
          />
        </label>
      </DevScope>
      {error ? <p className="hint hint--error" role="alert">{error}</p> : null}
    </form>
  </DevScope>
)

export default UiSettingsForm
