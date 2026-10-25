import { useEffect, useState } from 'react'
import { Button, DevScope, SelectDisplay } from 'component-library'
import api from '../api'
import WorkDirPicker from './WorkDirPicker'

const NewWorkspaceForm = ({ devId, popup, onCreated }) => {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [machines, setMachines] = useState([])
  const [machine, setMachine] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.loadMachines().then(({ self, machines: list }) => {
      if (cancelled || !list.length) return
      setMachines(list)
      setMachine(list.includes(self) ? self : list[0])
    })
    return () => { cancelled = true }
  }, [])

  const changeMachine = (next) => {
    setCwd('')
    setMachine(next)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { workspace } = await api.createWorkspace({
        machine,
        name: name.trim() || undefined,
        cwd: cwd || undefined,
      })
      if (onCreated) onCreated(workspace)
      if (popup && popup.close) popup.close()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DevScope id={devId} state={{ busy, error: Boolean(error), machine }}>
      <div className="new-session">
        <div className="new-session__header">
          <h2>New Workspace</h2>
          <p className="hint">Choose a root directory for your project sessions.</p>
        </div>

        {machines.length > 0 && (
          <DevScope id="hr4m7x2">
            <label className="field">
              <span className="field__label">Machine</span>
              <SelectDisplay
                selected={machine || ''}
                options={machines.map((item) => ({ value: item }))}
                select={changeMachine}
              />
            </label>
          </DevScope>
        )}

        <DevScope id="hr7m3n9">
          <label className="field">
            <span className="field__label">Workspace Name</span>
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to directory name"
            />
          </label>
        </DevScope>

        <DevScope id="hr2w8q4">
          <div className="field">
            <span className="field__label">Working Directory</span>
            {(!machines.length || machine) && (
              <WorkDirPicker devId="hr8n4j6" machine={machine} onChange={setCwd} />
            )}
          </div>
        </DevScope>

        {error && <p className="hint hint--error">{error}</p>}

        <div className="new-session__actions">
          {popup && (
            <Button variant="ghost" size="sm" onClick={() => popup.close()} devId="z8k2p7t">
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={submit} loading={busy} disabled={!cwd} devId="hr5c1p7">
            Create Workspace
          </Button>
        </div>
      </div>
    </DevScope>
  )
}

export default NewWorkspaceForm
