import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  CheckboxDisplay,
  DevScope,
  FoldContent,
  FoldDisplay,
  FoldTrigger,
  FormTextarea,
} from 'component-library'
import api from '../../api'

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const highlightText = (text, query) => {
  const parts = query.trim().split(/\s+/).filter(Boolean)
  if (!parts.length || !text) return text
  const pattern = new RegExp(parts.map(escapeRegExp).join('\\s+'), 'gi')
  const nodes = []
  let cursor = 0
  let key = 0
  let match = pattern.exec(text)
  while (match) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    nodes.push(<mark key={key} className="registry__search-hit">{match[0]}</mark>)
    key += 1
    cursor = match.index + match[0].length
    if (match[0].length === 0) pattern.lastIndex += 1
    match = pattern.exec(text)
  }
  if (!nodes.length) return text
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

const Template = ({ template, query = '' }) => (
  <pre className="registry__prompt">
    {template === '' ? '(Empty template)' : template.split(/(\{\{\w+\}\})/g).map((part, index) => (
      index % 2 ? <mark key={index} className="registry__var">{highlightText(part, query)}</mark> : highlightText(part, query)
    ))}
  </pre>
)

const versionStatus = (version) => {
  if (version.pluginOverride) return 'Plugin overlay'
  if (version.edited) return 'Saved edit'
  if (version.model) return 'Inherited text and targets'
  if (version.provider == null) return 'Built-in default'
  return version.customized ? 'Built-in variant' : 'Inherits shared default'
}

const PromptCard = ({ prompt, scope, scopeName, disabled, onSaved, onBusyChange, query = '' }) => {
  const { provider, model, mode } = scope
  const mounted = useRef(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const selected = prompt
  const excluded = prompt.enabled === false
  const applicableProviders = prompt.applicableProviders || []
  const activation = prompt.activation
  const messageTypes = selected.messageTypes ?? selected.defaultMessageTypes ?? []
  const dirty = draft != null && (
    draft.template !== selected.template ||
    ['user', 'agent'].some((type) => draft.messageTypes.includes(type) !== messageTypes.includes(type))
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onBusyChange(prompt.id, false)
    }
  }, [prompt.id, onBusyChange])

  useEffect(() => {
    if (query.trim()) setOpen(true)
  }, [query])

  const edit = () => {
    onBusyChange(prompt.id, true)
    setDraft({ template: selected.template, messageTypes: [...messageTypes] })
  }
  const cancel = () => {
    setDraft(null)
    setError(null)
    onBusyChange(prompt.id, false)
  }

  const save = (template, targets) => {
    if (saving || disabled || selected.pluginOverride) return
    onBusyChange(prompt.id, true)
    setSaving(true)
    setError(null)
    api
      .updatePrompt(prompt.id, template, { provider, model, mode }, targets)
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
    <DevScope id="n3wtq8l" state={{ id: prompt.id, provider, model, mode, editing: draft != null, saving, excluded }}>
      <div className={excluded ? 'registry__prompt-card registry__prompt-card--excluded' : 'registry__prompt-card'}>
      <Card>
        <CardHeader>
          <strong>{prompt.name}</strong> <code className="registry__id">{prompt.id}</code>
          {excluded && <Badge size="small">Excluded by overlay</Badge>}
        </CardHeader>
        <CardSection>
          <p className="registry__flag-desc">{prompt.description}</p>
          <div className="registry__prompt-applicability">
            <strong>Used by</strong>
            {applicableProviders.map((id) => <Badge key={id} size="small" autoColor>{id}</Badge>)}
          </div>
          <div className="registry__prompt-applicability">
            <strong>Incoming message targets</strong>
            {messageTypes.map((type) => <Badge key={type} size="small">{type === 'user' ? 'User' : 'Agent'}</Badge>)}
            {messageTypes.length === 0 && <Badge size="small">Neither (disabled)</Badge>}
          </div>
          <div className="registry__prompt-activation">
            <div className="registry__chips">
              <strong>Activation</strong>
              <Badge size="small" variant="info">{activation?.kind || 'Condition'}</Badge>
              {activation?.scope && <Badge size="small">{activation.scope === 'first' ? 'First message only' : 'Every message'}</Badge>}
              {!activation?.patterns && <span className="hint">No text trigger</span>}
            </div>
            <p>{activation?.condition || prompt.description}</p>
            {activation?.patterns && <div className="registry__prompt-patterns">
              <span className="hint">Text patterns</span>
              {activation.patterns.map((pattern) => <code key={pattern}>{pattern}</code>)}
            </div>}
            {prompt.exclusions?.map((exclusion, index) => (
              <div key={index} className="registry__prompt-patterns">
                <strong>Negative trigger</strong>
                <p>{exclusion.description}</p>
                {exclusion.patterns.map(pattern => <code key={pattern}>{pattern}</code>)}
              </div>
            ))}
          </div>

          <div className="registry__prompt-editor">
            <FoldDisplay isOpen={open} toggle={() => setOpen((value) => !value)}>
              <FoldTrigger>{scopeName} · {draft != null ? dirty ? 'Unsaved edit' : 'Editing' : versionStatus(selected)}</FoldTrigger>
              <FoldContent>
                {open && <>
                  <p className="hint">
                    {selected.pluginOverride
                      ? `This prompt is supplied by ${selected.pluginSource || 'a plugin'}. Edit the plugin to change it.`
                      : model
                      ? `Saving replaces this prompt's text and targets for ${model}${mode ? ` in ${mode} mode` : ' in all modes'}, across every provider. Reset removes only this override and restores inherited text and targets${provider ? `, previewed for ${provider}` : ''}.`
                      : provider == null
                      ? 'Editing the shared default updates inherited text and targets, including built-in variants that adapt the shared text. Saved overrides keep their own values.'
                      : selected.edited
                        ? `This saved edit replaces the text and targets for ${provider} only.`
                        : selected.customized
                          ? `This is the built-in ${provider} variant. Saving an edit replaces its text and targets for this provider only.`
                          : `This version inherits the shared default. Saving text or targets creates a ${provider} override.`}
                    {provider && !applicableProviders.includes(provider) && ' This provider does not currently use this prompt.'}
                  </p>
                  {!selected.pluginOverride && <p className="hint">Reset restores both text and targets for this scope.</p>}
                  {prompt.vars?.length > 0 && <ul className="registry__list registry__vars">
                    {prompt.vars.map((item) => <li key={item.name}><code>{`{{${item.name}}}`}</code> {item.description}</li>)}
                  </ul>}
                  <DevScope id="dx7104n" state={{ editing: draft != null }}>
                    {draft == null ? <Template template={selected.template} query={query} /> : <>
                      <div className="registry__prompt-applicability" role="group" aria-label={`${prompt.name}: ${scopeName} incoming message targets`}>
                        <strong>Incoming message targets</strong>
                        {['user', 'agent'].map((type) => (
                          <CheckboxDisplay
                            key={type}
                            label={type === 'user' ? 'User' : 'Agent'}
                            checked={draft.messageTypes.includes(type)}
                            toggle={() => setDraft((current) => ({
                              ...current,
                              messageTypes: current.messageTypes.includes(type)
                                ? current.messageTypes.filter((item) => item !== type)
                                : [...current.messageTypes, type],
                            }))}
                            disabled={saving || disabled}
                          />
                        ))}
                        {draft.messageTypes.length === 0 && <span className="hint">Neither: disabled for both sources.</span>}
                      </div>
                      <FormTextarea
                        className="form__textarea registry__prompt-edit"
                        rows={Math.min(24, Math.max(4, draft.template.split('\n').length + 1))}
                        aria-label={`${prompt.name}: ${scopeName} template`}
                        field={{
                          value: draft.template,
                          onChange: (event) => {
                            const template = event.target.value
                            setDraft((current) => ({ ...current, template }))
                          },
                        }}
                        disabled={saving || disabled}
                      />
                    </>}
                  </DevScope>
                  {error && <p className="registry__error" role="alert">{error}</p>}
                  <div className="registry__prompt-actions">
                    {draft == null ? <>
                      <Button devId="r3e7p5d" variant="secondary" size="sm" disabled={saving || disabled || selected.pluginOverride} onClick={edit}>
                        {model ? 'Edit model replacement' : provider ? `Edit ${provider} version` : 'Edit shared default'}
                      </Button>
                      {selected.edited && !selected.pluginOverride && <Button devId="r9z2k6u" variant="secondary" size="sm" onClick={() => save(null)} disabled={saving || disabled}>
                        {saving ? 'Resetting…' : model ? 'Reset to inherited text and targets' : provider ? selected.builtIn ? 'Reset to built-in variant' : 'Reset to shared default' : 'Reset to built-in default'}
                      </Button>}
                    </> : <>
                      <Button devId="r5c1v8y" size="sm" onClick={() => save(draft.template, draft.messageTypes)} disabled={saving || disabled || (selected.edited && !dirty)}>
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
      </div>
    </DevScope>
  )
}

export default PromptCard
