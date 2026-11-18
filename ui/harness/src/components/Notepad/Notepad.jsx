import { useEffect, useRef, useState } from 'react'
import { DevScope, FormTextarea } from 'component-library'
import api from '../../api'
import './Notepad.css'

const SAVE_DELAY_MS = 500

const Notepad = ({ devId }) => {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(null)

  useEffect(() => {
    let cancelled = false
    api
      .getNote()
      .then((body) => {
        if (cancelled) return
        setText(body.text || '')
        setLoaded(true)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Flush an unsaved edit when the popup closes.
  useEffect(() => () => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    api.saveNote(pending.current.text).catch(() => {})
  }, [])

  const save = (next) => {
    api
      .saveNote(next)
      .then(() => setError(''))
      .catch((err) => setError(err.message))
  }

  const onChange = (event) => {
    const next = event.target.value
    setText(next)
    if (pending.current) clearTimeout(pending.current.timer)
    const timer = setTimeout(() => {
      pending.current = null
      save(next)
    }, SAVE_DELAY_MS)
    pending.current = { timer, text: next }
  }

  return (
    <DevScope id={devId} state={{ loaded, error: Boolean(error) }}>
      <div className="notepad">
        <h2 className="notepad__title">Notepad</h2>
        <DevScope id="5dty75y">
          <FormTextarea
            className="form__textarea notepad__text"
            aria-label="Notepad"
            placeholder={loaded ? 'Write anything…' : 'Loading…'}
            disabled={!loaded}
            field={{ value: text, onChange }}
          />
        </DevScope>
        {error && <DevScope id="2a8tbkp"><p className="notepad__error">{error}</p></DevScope>}
      </div>
    </DevScope>
  )
}

export default Notepad
