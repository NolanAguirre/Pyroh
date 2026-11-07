import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  DevScope,
  FoldContent,
  FoldDisplay,
  FoldTrigger,
} from 'component-library'
import api from '../../api'

const Template = ({ template }) => (
  <pre className="registry__prompt">
    {template === '' ? '(Empty template)' : template.split(/(\{\{\w+\}\})/g).map((part, index) => (
      index % 2 ? <mark key={index} className="registry__var">{part}</mark> : part
    ))}
  </pre>
)

const versionStatus = (version) => {
  if (version.edited) return 'Saved edit'
  if (version.model) return 'Inherited text'
  if (version.provider == null) return 'Built-in default'
  return version.customized ? 'Built-in variant' : 'Inherits shared default'
}

const PromptCard = ({ prompt, scope, scopeName, disabled, onSaved, onBusyChange }) => {
  const { provider, model, mode } = scope
  const mounted = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const selected = prompt
  const applicableProviders = prompt.applicableProviders || []
  const activation = prompt.activation

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onBusyChange(prompt.id, false)
    }
  }, [prompt.id, onBusyChange])

  const edit = () => {
    onBusyChange(prompt.id, true)
    setDraft(selected.template)
  }
  const cancel = () => {
    setDraft(null)
    setError(null)
    onBusyChange(prompt.id, false)
  }

  const save = (template) => {
    if (saving || disabled) return
    onBusyChange(prompt.id, true)
    setSaving(true)
    setError(null)
    api
      .updatePrompt(prompt.id, template, { provider, model, mode })
      .then((data) => {
        if (!mounted.current) return
        onSaved(data.prompt)
        setDraft(null)
        onBusyChange(prompt.id, false)
      })
      .catch((err) => {
        if (!mounted.current) return
        setError(err.message)
        onBusyChange(prompt.id, draft != null)
      })
      .finally(() => { if (mounted.current) setSaving(false) })
  }

  return (
    <DevScope id="n3wtq8l" state={{ id: prompt.id, provider, model, mode, editing: draft != null, saving }}>
      <Card>
        <CardHeader>
          <strong>{prompt.name}</strong> <code className="registry__id">{prompt.id}</code>
        </CardHeader>
        <CardSection>
          <p className="registry__flag-desc">{prompt.description}</p>
          <div className="registry__prompt-applicability">
            <strong>Used by</strong>
            {applicableProviders.map((id) => <Badge key={id} size="small" autoColor>{id}</Badge>)}
          </div>
          <div className="registry__prompt-activation">
            <div className="registry__chips">
              <strong>Shared activation</strong>
              <Badge size="small" variant="info">{activation?.kind || 'Condition'}</Badge>
              {activation?.scope && <Badge size="small">{activation.scope === 'first' ? 'First message only' : 'Every message'}</Badge>}
              {!activation?.patterns && <span className="hint">No text trigger</span>}
            </div>
            <p>{activation?.condition || prompt.description}</p>
            {activation?.patterns && <div className="registry__prompt-patterns">
              <span className="hint">Text patterns (shared by all versions)</span>
              {activation.patterns.map((pattern) => <code key={pattern}>{pattern}</code>)}
            </div>}
          </div>

          <div className="registry__prompt-editor">
            <FoldDisplay isOpen={open} toggle={() => setOpen((value) => !value)}>
              <FoldTrigger>{scopeName} · {draft != null ? 'Unsaved edit' : versionStatus(selected)}</FoldTrigger>
              <FoldContent>
                {open && <>
                  <p className="hint">
                    {model
                      ? `Saving replaces this prompt for ${model}${mode ? ` in ${mode} mode` : ' in all modes'}, across every provider. Reset removes only this override and restores inherited text${provider ? `, previewed for ${provider}` : ''}.`
                      : provider == null
                      ? 'Editing the shared default updates inherited versions and built-in variants that adapt the shared text. Saved provider edits keep their own text.'
                      : selected.edited
                        ? `This saved edit replaces the text for ${provider} only.`
                        : selected.customized
                          ? `This is the built-in ${provider} variant. Saving an edit replaces it for this provider only.`
                          : `This version inherits the shared default. Saving different text creates a ${provider} override.`}
                    {provider && !applicableProviders.includes(provider) && ' This provider does not currently use this prompt.'}
                  </p>
                  {prompt.vars?.length > 0 && <ul className="registry__list registry__vars">
                    {prompt.vars.map((item) => <li key={item.name}><code>{`{{${item.name}}}`}</code> {item.description}</li>)}
                  </ul>}
                  <DevScope id="dx7104n" state={{ editing: draft != null }}>
                    {draft == null ? <Template template={selected.template} /> : (
                      <textarea
                        className="form__textarea registry__prompt-edit"
                        rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
                        aria-label={`${prompt.name}: ${scopeName} template`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        disabled={saving}
                      />
                    )}
                  </DevScope>
                  {error && <p className="registry__error" role="alert">{error}</p>}
                  <div className="registry__prompt-actions">
                    {draft == null ? <>
                      <Button devId="r3e7p5d" variant="secondary" size="sm" disabled={saving || disabled} onClick={edit}>
                        {model ? 'Edit model replacement' : provider ? `Edit ${provider} version` : 'Edit shared default'}
                      </Button>
                      {selected.edited && <Button devId="r9z2k6u" variant="secondary" size="sm" onClick={() => save(null)} disabled={saving || disabled}>
                        {saving ? 'Resetting…' : model ? 'Reset to inherited text' : provider ? selected.builtIn ? 'Reset to built-in variant' : 'Reset to shared default' : 'Reset to built-in default'}
                      </Button>}
                    </> : <>
                      <Button devId="r5c1v8y" size="sm" onClick={() => save(draft)} disabled={saving || disabled || (selected.edited && draft === selected.template)}>
                        {saving ? 'Saving…' : model ? 'Save model replacement' : provider ? 'Save provider version' : 'Save shared default'}
                      </Button>
                      <Button devId="r2n9b4x" variant="secondary" size="sm" onClick={cancel} disabled={saving}>Cancel</Button>
                    </>}
                  </div>
                  <div className="registry__flag-modes"><span className="hint">Code consumers</span> {(prompt.usedBy || []).join(', ')}</div>
                </>}
              </FoldContent>
            </FoldDisplay>
          </div>
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default PromptCard
