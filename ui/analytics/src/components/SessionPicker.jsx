import { useEffect, useState } from 'react'
import { fetchJson } from './useReplay.js'
import { assumptionFields } from './replayModel.js'
import { date, shortId } from '../common/format.js'

export const SessionPicker = ({ onLoad, loading }) => {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState('')
  const [values, setValues] = useState({})
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setListLoading(true)
    setListError('')
    fetchJson('/analytics/api/subagent-sessions', { signal: controller.signal }).then(data => {
      if (!Array.isArray(data.sessions)) throw new Error('The session list response is invalid.')
      if (!controller.signal.aborted) setSessions(data.sessions)
    }).catch(error => {
      if (!controller.signal.aborted) setListError(error.message)
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false)
    })
    return () => controller.abort()
  }, [refresh])
  const submit = event => {
    event.preventDefault()
    if (!sessionId.trim() || loading) return
    const assumptions = Object.fromEntries(assumptionFields.filter(field => values[field.key] !== undefined && values[field.key] !== '').map(field => [field.key, Number(values[field.key])]))
    onLoad(sessionId.trim(), assumptions)
  }
  return <form className="session-form card-section" onSubmit={submit} aria-label="Load session replay"><div className="card-section__header"><div><h2>Choose a source session</h2><p className="card-section__description">Load the recorded coordinator and descendant work from analytics.</p></div><button className="button button--quiet" type="button" disabled={listLoading} onClick={() => setRefresh(value => value + 1)}>{listLoading ? 'Loading sessions…' : 'Refresh sessions'}</button></div>
    <div className="session-form__fields"><label className="field"><span className="field__label">Recorded sessions</span><select className="select" disabled={listLoading} value={sessions.some(session => session.id === sessionId) ? sessionId : ''} onChange={event => setSessionId(event.target.value)}><option value="">{listLoading ? 'Loading…' : 'Select a session'}</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.title || shortId(session.id)} · {date(session.updatedAt)}</option>)}</select></label><label className="field"><span className="field__label">Or enter a session ID</span><input className="input monospace" autoComplete="off" placeholder="s_…" value={sessionId} onChange={event => setSessionId(event.target.value)} required /><span className="field__hint">Use a known session ID if it is not in the list.</span></label><button className="button button--primary" type="submit" disabled={loading || !sessionId.trim()}>{loading ? 'Loading replay…' : 'Load replay'}</button></div>
    {listError && <p className="alert alert--warning" role="status">Session list unavailable: {listError} You can still enter an ID.</p>}
    {!listLoading && !listError && !sessions.length && <p className="muted">No sessions were listed. Enter a session ID to request its replay.</p>}
    <details className="disclosure"><summary>Optional legacy assumptions</summary><p className="muted">Version 4 records these accepted overrides but does not apply them to the ordered replay. Leave fields blank to send no overrides. Values must be whole numbers.</p><div className="session-form__fields">{assumptionFields.map(field => <label className="field" key={field.key}><span className="field__label">{field.label}</span><input className="input" type="number" min={field.min} max={field.max} step="1" value={values[field.key] ?? ''} placeholder="Not supplied" onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} /><span className="field__hint monospace">{field.key}</span></label>)}</div></details>
  </form>
}
