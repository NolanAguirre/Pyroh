import { useState } from 'react'
import { Button } from 'component-library'
import { DEFAULT_HOTKEYS, formatHotkey, hotkeyFromEvent } from '../hotkeys'

const HotkeySettings = ({ hotkeys, changeHotkey, ready, saving, error }) => {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')

  const record = (event) => {
    if (!recording || event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(false)
      setHint('')
      return
    }
    const binding = hotkeyFromEvent(event)
    if (!binding) {
      setHint('Use Ctrl, Alt, or Meta with a key, or a function key (F1–F12).')
      return
    }
    changeHotkey('newChat', binding)
    setRecording(false)
    setHint('')
  }

  return (
    <div className="ui-settings__hotkeys" data-hotkey-recorder>
      <span className="field__label">New chat in current workspace</span>
      <p className="hint">Uses the default model and settings. Available on the chat page.</p>
      <Button
        variant="secondary"
        disabled={!ready || saving}
        aria-label={`New chat shortcut: ${formatHotkey(hotkeys.newChat)}. Press to rebind.`}
        onClick={() => { setRecording(true); setHint('') }}
        onKeyDown={record}
        onBlur={() => { setRecording(false); setHint('') }}
      >
        {recording ? 'Press a shortcut…' : formatHotkey(hotkeys.newChat)}
      </Button>
      <div className="ui-settings__hotkey-actions">
        <Button variant="ghost" size="sm" disabled={!ready || saving || !hotkeys.newChat} onClick={() => changeHotkey('newChat', null)}>Disable</Button>
        <Button variant="ghost" size="sm" disabled={!ready || saving} onClick={() => changeHotkey('newChat', DEFAULT_HOTKEYS.newChat)}>Reset</Button>
      </div>
      <p className="hint" aria-live="polite">{saving ? 'Saving…' : hint || (recording ? 'Escape cancels.' : 'Select the shortcut to rebind it.')}</p>
      {error && <p className="hint hint--error" role="alert">{error}</p>}
    </div>
  )
}

export default HotkeySettings
