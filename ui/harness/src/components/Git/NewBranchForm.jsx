import { useState } from 'react'
import { Button, DevScope } from 'component-library'

const NewBranchForm = ({ devId, popup, current, busy, onCreate }) => {
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const branch = name.trim()
    if (!branch) return
    const result = await onCreate(branch, startPoint.trim())
    if (result && popup && popup.close) {
      setName('')
      setStartPoint('')
      popup.close()
    }
  }

  return (
    <DevScope id={devId} state={{ busy: Boolean(busy) }}>
      <form className="new-session" onSubmit={submit}>
        <div className="new-session__header">
          <h2>New Branch</h2>
          <p className="hint">Creates the branch and switches to it. Uncommitted changes come along.</p>
        </div>
        <DevScope id="6u9kgy3">
          <label className="field">
            <span className="field__label">Branch name</span>
            <input
              className="text-input"
              value={name}
              autoFocus
              placeholder="feature/my-change"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </DevScope>
        <DevScope id="jfgv8t6">
          <label className="field">
            <span className="field__label">Start from</span>
            <input
              className="text-input"
              value={startPoint}
              placeholder={current ? `${current} (current)` : 'HEAD'}
              onChange={(event) => setStartPoint(event.target.value)}
            />
          </label>
        </DevScope>
        <div className="new-session__actions">
          {popup && (
            <Button devId="xfas6fn" variant="ghost" size="sm" type="button" onClick={() => popup.close()}>
              Cancel
            </Button>
          )}
          <Button devId="og76ww7" variant="primary" type="submit" loading={busy === 'checkout'} disabled={!name.trim()}>
            Create Branch
          </Button>
        </div>
      </form>
    </DevScope>
  )
}

export default NewBranchForm
