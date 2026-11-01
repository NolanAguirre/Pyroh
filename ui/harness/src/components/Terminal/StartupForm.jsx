import { useEffect, useState } from 'react'
import { Button, DevScope } from 'component-library'
import api from '../../api'
import { errorText } from './terminalUtils'

const STARTUP_PLACEHOLDER = '# workspace name\n## tab name\nnpm run dev'

const StartupForm = ({ devId, popup, onSave, onError }) => {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getTerminalStartup()
      .then((body) => {
        if (!cancelled) setText(typeof body?.text === 'string' ? body.text : '')
      })
      .catch((err) => {
        if (!cancelled) onError(errorText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onError])

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onSave(text)
    setSaving(false)
    if (ok && popup && popup.close) popup.close()
  }

  return (
    <DevScope id={devId} state={{ loading, saving }}>
      <form className="new-session terminal-startup" onSubmit={submit}>
        <div className="new-session__header">
          <h2>Startup terminals</h2>
          <p className="hint">
            <code># name</code> picks a workspace, <code>## name</code> opens a tab, and the lines below it run in that tab.
          </p>
        </div>
        <textarea
          className="text-input terminal-startup__text"
          value={text}
          placeholder={STARTUP_PLACEHOLDER}
          spellCheck={false}
          autoFocus
          disabled={loading}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="terminal-startup__actions">
          <Button devId="s4t8rpv" variant="primary" size="sm" type="submit" disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </DevScope>
  )
}

export default StartupForm
