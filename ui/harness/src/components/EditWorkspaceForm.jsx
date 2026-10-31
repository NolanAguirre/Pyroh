import { useEffect, useState } from 'react'
import { Button, DevScope } from 'component-library'
import api from '../api'

const workspaceName = (workspace) => {
  if (!workspace) return ''
  const suffix = workspace.machine ? `@${workspace.machine}` : ''
  if (suffix && workspace.name.endsWith(suffix)) return workspace.name.slice(0, -suffix.length)
  return workspace.name || ''
}

const EditWorkspaceForm = ({ devId, popup, workspace, onUpdated }) => {
  const currentName = workspaceName(workspace)
  const currentCwd = workspace?.cwd || ''
  const [name, setName] = useState(currentName)
  const [cwd, setCwd] = useState(currentCwd)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!popup?.isOpen) return
    setName(currentName)
    setCwd(currentCwd)
    setError(null)
  }, [popup?.isOpen, currentName, currentCwd])

  const nameNext = name.trim()
  const cwdNext = cwd.trim()
  const dirty = nameNext !== currentName || cwdNext !== currentCwd

  const submit = async () => {
    if (!workspace || busy || !nameNext || !cwdNext || !dirty) return
    setBusy(true)
    setError(null)
    try {
      const { workspace: next } = await api.updateWorkspace(workspace.id, {
        name: nameNext,
        cwd: cwdNext,
      })
      if (onUpdated) onUpdated(next)
      if (popup && popup.close) popup.close()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DevScope id={devId} state={{ busy, error: Boolean(error), dirty }}>
      <form
        className="new-session"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="new-session__header">
          <h2>Edit Workspace</h2>
          <p className="hint">Saving a new directory renames the folder on disk.</p>
        </div>

        <DevScope id="p7c2k9d">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Workspace name"
              autoFocus
              disabled={busy}
            />
          </label>
        </DevScope>

        <DevScope id="t5h1v6b">
          <label className="field">
            <span className="field__label">Directory</span>
            <input
              className="text-input text-input--path"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/path/to/repo"
              spellCheck={false}
              disabled={busy}
            />
          </label>
        </DevScope>

        {error && <p className="hint hint--error">{error}</p>}

        <div className="new-session__actions">
          {popup && (
            <Button variant="ghost" size="sm" onClick={() => popup.close()} disabled={busy} devId="y9n3e8r">
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            loading={busy}
            disabled={!nameNext || !cwdNext || !dirty}
            devId="c6j4a1s"
          >
            Save
          </Button>
        </div>
      </form>
    </DevScope>
  )
}

export default EditWorkspaceForm
