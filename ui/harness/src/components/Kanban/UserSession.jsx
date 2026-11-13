import { useEffect, useRef, useState } from 'react'
import { Button, FormInput, DevScope } from 'component-library'
import { signIn } from './api'

const rememberedName = () => {
  try { return localStorage.getItem('kanban-user-name') || '' } catch { return '' }
}

const UserSession = ({ devId, children }) => {
  const [name, setName] = useState(rememberedName)
  const [user, setUser] = useState(null)
  const [busy, setBusy] = useState(Boolean(name))
  const [error, setError] = useState('')
  const submitting = useRef(false)

  useEffect(() => {
    const saved = rememberedName()
    if (!saved) return
    let active = true
    signIn(saved).then((result) => {
      if (active) setUser(result.signIn.user)
    }).catch((failure) => {
      if (active) setError(failure.message)
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (busy || submitting.current || !name.trim()) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await signIn(name.trim())
      const nextUser = result.signIn.user
      try { localStorage.setItem('kanban-user-name', nextUser.name) } catch { /* Storage is optional. */ }
      setUser(nextUser)
    } catch (failure) {
      setError(failure.message)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (user) return children(user, () => {
    try { localStorage.removeItem('kanban-user-name') } catch { /* Storage is optional. */ }
    setUser(null)
    setName('')
    setError('')
  })

  return <DevScope id={devId} state={{ busy }}><div className="kanban__sign-in-page">
    <form className="kanban__editor kanban__sign-in-form" onSubmit={submit} aria-busy={busy}>
      <h1>What’s your name?</h1>
      <p>Your name will appear on tasks, comments, and replies. No password needed.</p>
      <label>Your name<DevScope id="kd2oywv"><FormInput field={{ value: name, onChange: (event) => setName(event.target.value) }}
        autoFocus autoComplete="name" required maxLength={100} disabled={busy} /></DevScope></label>
      {error && <p role="alert" className="kanban__error">{error}</p>}
      <div className="kanban__editor-actions"><Button type="submit" disabled={busy || !name.trim()} devId="zsyde9h">{busy ? 'Signing in…' : 'Continue'}</Button></div>
    </form>
  </div></DevScope>
}

export default UserSession
