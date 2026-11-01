import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  DevScope,
} from 'component-library'
import api from '../../api'

const Template = ({ template }) => (
  <pre className="registry__prompt">
    {template.split(/(\{\{\w+\}\})/g).map((part, index) => (
      index % 2 ? <mark key={index} className="registry__var">{part}</mark> : part
    ))}
  </pre>
)

const PromptCard = ({ prompt, onSaved }) => {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = (template) => {
    setSaving(true)
    setError(null)
    api
      .updatePrompt(prompt.id, template)
      .then((data) => {
        onSaved(data.prompt)
        setDraft(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false))
  }

  return (
    <DevScope id="n3wtq8l" state={{ id: prompt.id, editing: draft != null, saving }}>
      <Card>
        <CardHeader>
          <strong>{prompt.name}</strong> <code className="registry__id">{prompt.id}</code>
          {prompt.edited && <> <Badge size="small" variant="info">edited</Badge></>}
        </CardHeader>
        <CardSection>
          <p className="registry__flag-desc">{prompt.description}</p>
          {prompt.vars.length ? (
            <ul className="registry__list registry__vars">
              {prompt.vars.map((item) => (
                <li key={item.name}><code>{`{{${item.name}}}`}</code> {item.description}</li>
              ))}
            </ul>
          ) : (
            <p className="hint">No variables.</p>
          )}
          <DevScope id="dx7104n" state={{ editing: draft != null }}>
            {draft == null ? (
              <Template template={prompt.template} />
            ) : (
              <textarea
                className="form__textarea registry__prompt-edit"
                rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
                aria-label={`${prompt.name} template`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
              />
            )}
          </DevScope>
          {error && <p className="registry__error">{error}</p>}
          <div className="registry__prompt-actions">
            {draft == null ? (
              <>
                <Button devId="r3e7p5d" variant="secondary" size="sm" onClick={() => setDraft(prompt.template)}>Edit</Button>
                {prompt.edited && (
                  <Button devId="r9z2k6u" variant="secondary" size="sm" onClick={() => save(null)} disabled={saving}>Reset to default</Button>
                )}
              </>
            ) : (
              <>
                <Button devId="r5c1v8y" size="sm" onClick={() => save(draft)} disabled={saving || draft === prompt.template}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button devId="r2n9b4x" variant="secondary" size="sm" onClick={() => { setDraft(null); setError(null) }} disabled={saving}>Cancel</Button>
              </>
            )}
          </div>
          <div className="registry__flag-modes">
            <span className="hint">Used by</span> {prompt.usedBy.join(', ')}
          </div>
        </CardSection>
      </Card>
    </DevScope>
  )
}

export default PromptCard
