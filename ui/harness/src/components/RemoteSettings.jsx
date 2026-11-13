import { useEffect, useState } from 'react'
import { Button } from 'component-library'
import api from '../api'

const RemoteSettings = () => {
  const [config, setConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    api.getRemotes().then(({ config: saved }) => {
      if (!cancelled) setConfig({ self: saved.self || '', resolver: saved.resolver || '', machines: saved.machines || [] })
    }).catch((err) => {
      if (!cancelled) setError(err.message)
    })
    return () => { cancelled = true }
  }, [attempt])

  const change = (next) => {
    setConfig(next)
    setError('')
    setMessage('')
  }

  const updateMachine = (index, key, value) => {
    const previous = config.machines[index]
    change({
      ...config,
      self: key === 'name' && config.self && config.self === previous.name ? value : config.self,
      machines: config.machines.map((machine, i) => i === index ? { ...machine, [key]: value } : machine),
    })
  }

  const removeMachine = (index) => change({
    ...config,
    self: config.self === config.machines[index].name ? '' : config.self,
    machines: config.machines.filter((_, i) => i !== index),
  })

  const save = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api.setRemotes({
        self: config.self.trim() || null,
        resolver: config.resolver.trim() || null,
        machines: config.machines.map(({ name, host }) => ({ name: name.trim(), host: host.trim() })),
      })
      setConfig({ ...result.config, self: result.config.self || '', resolver: result.config.resolver || '' })
      setMessage(result.applied ? 'Saved. Routing reloaded and workspace list refreshed.' : 'Saved. Start the local nginx service to use these routes.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ui-settings__remotes">
      <p className="hint">Connect this Pyroh to other running instances. Remote workspaces appear as workspace@name. Local workspaces stay available.</p>
      {!config && !error && <p className="hint" role="status">Loading remotes…</p>}
      {config && <>
        <fieldset className="ui-settings__remote-fields" disabled={busy}>
          <div className="ui-settings__remote-list">
            {!config.machines.length && <p className="hint">No remotes configured.</p>}
            {config.machines.map((machine, index) => (
              <div className="ui-settings__remote" key={index}>
                <label className="field">
                  <span className="field__label">Name</span>
                  <input className="text-input" value={machine.name} placeholder="enclave-host" autoCapitalize="none" spellCheck={false} onChange={(event) => updateMachine(index, 'name', event.target.value)} />
                  <span className="hint">Lowercase letters, numbers, hyphens, and underscores.</span>
                </label>
                <label className="field">
                  <span className="field__label">Address</span>
                  <input className="text-input" value={machine.host} placeholder="10.0.0.20:6060" autoCapitalize="none" spellCheck={false} onChange={(event) => updateMachine(index, 'host', event.target.value)} />
                </label>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${machine.name || 'remote'}`} onClick={() => removeMachine(index)}>Remove</Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => change({ ...config, machines: [...config.machines, { name: '', host: '' }] })}>Add remote</Button>
          <p className="hint">Use the remote nginx host and port, without http:// or a path. For an existing SSH tunnel, use its local address, such as 127.0.0.1:7060.</p>
          <label className="field">
            <span className="field__label">DNS resolver (optional for IP addresses)</span>
            <input className="text-input" value={config.resolver} placeholder="10.0.0.1" spellCheck={false} onChange={(event) => change({ ...config, resolver: event.target.value })} />
            <span className="hint">Required for hostnames. Use a DNS server that can resolve your remote names.</span>
          </label>
          <label className="field">
            <span className="field__label">Local machine route (optional)</span>
            <select className="text-input" value={config.self} onChange={(event) => change({ ...config, self: event.target.value })}>
              <option value="">Use local services directly</option>
              {config.machines.filter(({ name }) => name).map(({ name }, index) => <option key={index} value={name}>{name}</option>)}
            </select>
            <span className="hint">Only select a route that points back to this machine.</span>
          </label>
        </fieldset>
        <Button type="button" variant="primary" disabled={busy} loading={busy} onClick={save}>Save remotes</Button>
      </>}
      {message && <p className="hint" role="status">{message}</p>}
      {error && <p className="hint hint--error" role="alert">{error}</p>}
      {!config && error && <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>Retry</Button>}
    </div>
  )
}

export default RemoteSettings
