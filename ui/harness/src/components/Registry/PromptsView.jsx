import { Button, DevScope } from 'component-library'
import PromptCard from './PromptCard'
import usePrompts from './usePrompts'

const PromptsView = ({ providers = [] }) => {
  const { prompts, error, loading, replace, refresh } = usePrompts(providers)
  const groups = [...new Set((prompts || []).map((prompt) => prompt.group))]
  return (
    <DevScope id="r8q4w1v">
      <div className="registry__prompts-intro">
        <div>
          <strong>Prompts & provider versions</strong>
          <p className="hint">One card is one logical prompt. Its trigger or condition is shared by every provider version; versions change the text only.</p>
          <p className="hint">Choose a version to view or edit. Inherited versions follow the shared default. Built-in variants adapt it; saved provider edits replace it. Changes apply across workspaces.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh prompts'}
        </Button>
      </div>
      {error && <DevScope id="9kbs589"><p className="registry__error" role="alert">{prompts ? 'Could not refresh prompts. Displayed versions may be out of date. ' : ''}{error}</p></DevScope>}
      {!prompts && loading && <DevScope id="62o4caw"><p className="hint">Loading shared prompts and provider versions…</p></DevScope>}
      {prompts && <p className="hint">{prompts.length} logical prompts · {providers.length} registered providers. “Used by” shows which providers actually consume each prompt.</p>}
      {groups.map((group) => (
        <DevScope key={group} id="va0d167" state={{ group }}>
          <section className="registry__prompt-group">
            <h3 className="registry__group-title">{group}</h3>
            <div className="registry__prompt-families">
              {prompts.filter((prompt) => prompt.group === group).map((prompt) => <PromptCard key={prompt.id} prompt={prompt} onSaved={replace} />)}
            </div>
          </section>
        </DevScope>
      ))}
    </DevScope>
  )
}

export default PromptsView
