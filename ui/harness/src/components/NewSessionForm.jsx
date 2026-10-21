import { useMemo, useState } from 'react'
import {
  DropdownTypeahead,
  DropdownTypeaheadTrigger,
  DropdownTypeaheadMenu,
  Button,
  DevScope,
} from 'component-library'
import api from '../api'
import CodexSettings from './CodexSettings'
import GrokSettings from './GrokSettings'
import ClaudeSettings from './ClaudeSettings'

const NewSessionForm = ({
  devId,
  providers = [],
  workspace,
  workspaces,
  defaults = {},
  title = 'New Session',
  submitLabel = 'Create Session',
  afterCreate,
  popup,
  onCreated,
}) => {
  const [workspaceId, setWorkspaceId] = useState(defaults.workspaceId || workspace?.id || '')
  const [provider, setProvider] = useState(defaults.provider || providers[0]?.id || 'cursor')
  const [model, setModel] = useState(defaults.model || '')
  const [codex, setCodex] = useState({ reasoningEffort: '', sandbox: 'danger-full-access', approvalPolicy: 'never', webSearch: 'cached', ...defaults.codex })
  const [grok, setGrok] = useState({ reasoningEffort: '', ...defaults.grok })
  const [claude, setClaude] = useState({ reasoningEffort: '', permissionMode: 'bypassPermissions', ...defaults.claude })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const selectedWorkspace = workspaces?.find((item) => item.id === workspaceId) || workspace
  const workspaceOptions = (workspaces || []).map((item) => ({ value: item.id, displayValue: item.name }))

  const providerOptions = providers.map((p) => ({
    value: p.id,
    displayValue: p.implemented ? p.id : `${p.id} (unavailable)`,
  }))

  const current = useMemo(
    () => providers.find((p) => p.id === provider),
    [providers, provider],
  )

  const modelOptions = (current?.models || []).map((m) => ({
    value: m.id,
    displayValue: m.displayName || m.id,
  }))

  const implemented = current ? current.implemented : true
  const selectedModel = current?.models?.find((entry) => entry.id === model) || current?.models?.[0]

  const submit = async () => {
    if (!selectedWorkspace) {
      setError('Create a workspace first')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const chosenModel = model || current?.models?.[0]?.id || null
      const { session } = await api.createSession({
        workspaceId: selectedWorkspace.id,
        provider,
        model: chosenModel,
        ...(provider === 'codex' ? { codex } : {}),
        ...(provider === 'grok' ? { grok } : {}),
        ...(provider === 'claude' ? { claude } : {}),
      })
      if (afterCreate) await afterCreate(session)
      if (onCreated) onCreated(session)
      if (popup && popup.close) popup.close()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DevScope id={devId} state={{ provider, model, busy, error: Boolean(error) }}>
      <div className="new-session">
        <div className="new-session__header">
          <h2>{title}</h2>
          {selectedWorkspace && (
            <p className="hint new-session__workspace-hint">
              <strong>{selectedWorkspace.name}</strong> · <code>{selectedWorkspace.cwd}</code>
            </p>
          )}
        </div>

        {workspaceOptions.length > 0 && (
          <DevScope id="w5k2n8r" state={{ workspaceId }}>
            <div className="field">
              <span className="field__label">Workspace</span>
              <DropdownTypeahead
                defaultValue={workspaceId}
                options={workspaceOptions}
                change={setWorkspaceId}
              >
                <DropdownTypeaheadTrigger />
                <DropdownTypeaheadMenu />
              </DropdownTypeahead>
            </div>
          </DevScope>
        )}

        <DevScope id="hr9d2h5" state={{ provider }}>
          <div className="field">
            <span className="field__label">Provider</span>
            <DropdownTypeahead
              defaultValue={provider}
              options={providerOptions}
              change={(value) => {
                setProvider(value)
                setModel('')
                setCodex((prev) => ({ ...prev, reasoningEffort: '' }))
                setGrok((prev) => ({ ...prev, reasoningEffort: '' }))
                setClaude((prev) => ({ ...prev, reasoningEffort: '' }))
              }}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>

        <DevScope id="hr1s7b3" state={{ model }}>
          <div className="field">
            <span className="field__label">Model</span>
            <DropdownTypeahead
              key={provider}
              defaultValue={model || modelOptions[0]?.value || ''}
              options={modelOptions.length ? modelOptions : [{ value: '', displayValue: 'default' }]}
              change={(value) => {
                setModel(value)
                setCodex((prev) => ({ ...prev, reasoningEffort: '' }))
                setGrok((prev) => ({ ...prev, reasoningEffort: '' }))
                setClaude((prev) => ({ ...prev, reasoningEffort: '' }))
              }}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>

        {provider === 'codex' && <CodexSettings devId="t3q8j5n" value={codex} model={selectedModel} onChange={setCodex} />}
        {provider === 'grok' && <GrokSettings devId="m4x8r1q" value={grok} model={selectedModel} onChange={setGrok} />}
        {provider === 'claude' && <ClaudeSettings devId="c46cfdw" value={claude} model={selectedModel} onChange={setClaude} />}
        {current?.error && <p className="hint hint--error">{current.error}</p>}
        {!implemented && (
          <p className="hint hint--warn">This provider is not implemented yet.</p>
        )}
        {error && <p className="hint hint--error">{error}</p>}

        <div className="new-session__actions">
          {popup && (
            <Button variant="ghost" size="sm" onClick={() => popup.close()} devId="q4v8b1e">
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={!implemented || !selectedWorkspace || Boolean(current?.error)}
            devId="hr0x6m8"
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </DevScope>
  )
}

export default NewSessionForm
