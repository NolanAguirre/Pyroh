import { useState } from 'react'
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
    {template.split(/(\{\{\w+\}\})/g).map((part, index) => (
      index % 2 ? <mark key={index} className="registry__var">{part}</mark> : part
    ))}
  </pre>
)

const versionStatus = (version) => {
  if (version.edited) return 'Saved edit'
  if (version.provider == null) return 'Built-in default'
  return version.customized ? 'Built-in variant' : 'Inherits shared default'
}

const PromptCard = ({ prompt, onSaved }) => {
  const [provider, setProvider] = useState(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const versions = [prompt, ...prompt.versions]
  const selected = versions.find((version) => version.provider === provider) || prompt
  const scopeName = provider || 'Shared default'
  const applicableProviders = prompt.applicableProviders || []
  const activation = prompt.activation

  const save = (template) => {
    setSaving(true)
    setError(null)
    api
      .updatePrompt(prompt.id, template, { provider })
      .then((data) => {
        onSaved(data.prompt)
        setDraft(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false))
  }

  return (
    <DevScope id="n3wtq8l" state={{ id: prompt.id, provider, editing: draft != null, saving }}>
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

          <p className="registry__prompt-versions-label"><strong>Versions of this prompt</strong> <span className="hint">Select to view text</span></p>
          <div className="registry__prompt-versions" role="group" aria-label={`${prompt.name} versions`}>
            {versions.map((version) => {
              const active = version.provider === provider
              const unused = version.provider != null && !applicableProviders.includes(version.provider)
              return (
                <Button
                  key={version.provider || 'shared'}
                  variant={active ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={active}
                  disabled={draft != null || saving}
                  onClick={() => { setProvider(version.provider); setError(null); setOpen(true) }}
                >
                  <Badge size="small" autoColor={version.provider != null}>{version.provider || 'Shared default'}</Badge>
                  <span className="registry__prompt-version-status">{versionStatus(version)}</span>
                  {unused && <span className="registry__prompt-version-status">Registered; not used</span>}
                </Button>
              )
            })}
          </div>
          {applicableProviders.length < prompt.versions.length && <p className="hint">Every provider registers a version. Versions marked “not used” have no consumer in that provider.</p>}
          {draft != null && <p className="hint">Save or cancel this edit before switching versions.</p>}

          <div className="registry__prompt-editor">
            <FoldDisplay isOpen={open} toggle={() => setOpen((value) => !value)}>
              <FoldTrigger>{scopeName} · {draft != null ? 'Unsaved edit' : versionStatus(selected)}</FoldTrigger>
              <FoldContent>
                {open && <>
                  <p className="hint">
                    {provider == null
                      ? 'Editing the shared default updates inherited versions and built-in variants that adapt the shared text. Saved provider edits keep their own text.'
                      : selected.edited
                        ? `This saved edit replaces the text for ${provider} only.`
                        : selected.customized
                          ? `This is the built-in ${provider} variant. Saving an edit replaces it for this provider only.`
                          : `This version inherits the shared default. Saving different text creates a ${provider} override.`}
                    {provider && !applicableProviders.includes(provider) && ' This provider does not currently use this prompt.'}
                  </p>
                  {prompt.vars.length > 0 && <ul className="registry__list registry__vars">
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
                      <Button devId="r3e7p5d" variant="secondary" size="sm" disabled={saving} onClick={() => setDraft(selected.template)}>
                        {provider ? `Edit ${provider} version` : 'Edit shared default'}
                      </Button>
                      {selected.edited && <Button devId="r9z2k6u" variant="secondary" size="sm" onClick={() => save(null)} disabled={saving}>
                        {saving ? 'Resetting…' : provider ? selected.builtIn ? 'Reset to built-in variant' : 'Reset to shared default' : 'Reset to built-in default'}
                      </Button>}
                    </> : <>
                      <Button devId="r5c1v8y" size="sm" onClick={() => save(draft)} disabled={saving || draft === selected.template}>
                        {saving ? 'Saving…' : provider ? 'Save provider version' : 'Save shared default'}
                      </Button>
                      <Button devId="r2n9b4x" variant="secondary" size="sm" onClick={() => { setDraft(null); setError(null) }} disabled={saving}>Cancel</Button>
                    </>}
                  </div>
                  <div className="registry__flag-modes"><span className="hint">Code consumers</span> {prompt.usedBy.join(', ')}</div>
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
