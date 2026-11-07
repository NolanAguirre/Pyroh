import { useCallback, useState } from 'react'
import { Button, DevScope, FormSearch, SelectDisplay } from 'component-library'
import PromptCard from './PromptCard'
import usePrompts from './usePrompts'

const compact = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

const matchesPrompt = (prompt, query) => {
  const needle = compact(query)
  if (!needle) return true
  return [prompt.name, prompt.id, prompt.description, prompt.group, prompt.template]
    .some((value) => compact(value).includes(needle))
}

// SelectDisplay normalizes string values. Numeric option keys preserve catalog IDs.
const scopeOptions = (items, allLabel) => [
  { value: '0', displayValue: allLabel },
  ...items.map((item, index) => ({ value: String(index + 1), displayValue: item.label || item.id })),
]
const selectedOption = (items, id) => String(items.findIndex((item) => item.id === id) + 1)

const PromptsView = ({ providers = [] }) => {
  const [provider, setProvider] = useState(null)
  const [model, setModel] = useState(null)
  const [mode, setMode] = useState(null)
  const [query, setQuery] = useState('')
  const [busyCards, setBusyCards] = useState(() => new Set())
  const { prompts, models, modes, error, loading, replace, refresh, scopeKey } = usePrompts({ provider, model, mode })
  const onBusyChange = useCallback((id, busy) => {
    setBusyCards((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const busy = busyCards.size > 0
  const needle = query.trim()
  const matched = (prompts || []).filter((prompt) => matchesPrompt(prompt, needle))
  const matchedIds = new Set(matched.map((prompt) => prompt.id))
  const visible = !prompts ? [] : needle
    ? prompts.filter((prompt) => busyCards.has(prompt.id) || matchedIds.has(prompt.id))
    : prompts
  const groups = [...new Set(visible.map((prompt) => prompt.group))]
  const modelOptions = model && !models.some((item) => item.id === model) ? [...models, { id: model }] : models
  const modeOptions = mode && !modes.some((item) => item.id === mode) ? [...modes, { id: mode }] : modes
  const scopeName = model ? `${model} · ${mode || 'All modes'}` : provider || 'Shared default'

  return (
    <DevScope id="r8q4w1v" state={{ provider, model, mode, search: needle.length, shown: visible.length }}>
      <div className="registry__prompts-intro">
        <div>
          <strong>Prompt templates</strong>
          <p className="hint">Edit template text and message targets for a shared, provider, model, or model + mode scope. Targets describe the source of the incoming message: user or agent, not the model role or mode. Select both, either, or neither. Neither disables the prompt for both sources. Changes apply across workspaces.</p>
        </div>
        <div className="registry__prompts-actions">
          <div className="registry__prompt-search">
            <FormSearch
              field={{
                value: query,
                onChange: (event) => {
                  if (!busy) setQuery(event.target.value)
                },
              }}
              placeholder="Paste prompt text to find it"
              aria-label="Search prompts"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) {
                  event.preventDefault()
                  setQuery('')
                }
              }}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={loading || busy}>
            {loading ? 'Loading…' : 'Refresh prompts'}
          </Button>
        </div>
      </div>
      <div className="registry__filters">
        <label>Model{' '}
          <SelectDisplay className="registry__select" aria-label="Prompt model" selected={selectedOption(modelOptions, model)} options={scopeOptions(modelOptions, 'All models')} disabled={busy} select={(value) => { setModel(modelOptions[Number(value) - 1]?.id || null); setMode(null) }} />
        </label>
        <label>Mode{' '}
          <SelectDisplay className="registry__select" aria-label="Prompt mode" selected={selectedOption(modeOptions, mode)} options={scopeOptions(modeOptions, 'All modes')} disabled={busy || !model} select={(value) => setMode(modeOptions[Number(value) - 1]?.id || null)} />
        </label>
        <label>{model ? 'Provider preview' : 'Provider'}{' '}
          <SelectDisplay className="registry__select" aria-label={model ? 'Inherited provider preview' : 'Prompt provider'} selected={selectedOption(providers, provider)} options={scopeOptions(providers, model ? 'Shared preview' : 'Shared default')} disabled={busy} select={(value) => setProvider(providers[Number(value) - 1]?.id || null)} />
        </label>
      </div>
      <p className="hint">
        {model
          ? `Editing ${scopeName} across all providers. The provider choice only sets the inherited preview. Text and targets inherit through shared → provider → model → model + mode.`
          : 'All models edits the shared default or the selected provider version. Choose a model to edit a replacement across providers, then optionally choose a mode.'}
      </p>
      {busy && <p className="hint">Save or cancel open edits before changing scope or refreshing.</p>}
      {error && <DevScope id="9kbs589"><p className="registry__error" role="alert">{prompts ? 'Could not refresh prompts. Displayed text and targets may be out of date. ' : ''}{error}</p></DevScope>}
      {!prompts && loading && <DevScope id="62o4caw"><p className="hint">Loading selected prompt scope…</p></DevScope>}
      {prompts && <p className="hint">
        {needle
          ? `${matched.length} of ${prompts.length} prompts match this scope. Search checks name, id, and template text. Line breaks are ignored.`
          : `${prompts.length} logical prompts · ${providers.length} registered providers. “Used by” shows which providers consume each prompt.`}
      </p>}
      {prompts && needle && matched.length === 0 && <p className="hint">No prompts contain that text in this scope.</p>}
      {groups.map((group) => (
        <DevScope key={group} id="va0d167" state={{ group }}>
          <section className="registry__prompt-group">
            <h3 className="registry__group-title">{group}</h3>
            <div className="registry__prompt-families">
              {visible.filter((prompt) => prompt.group === group).map((prompt) => (
                <PromptCard key={`${scopeKey}:${prompt.id}`} prompt={prompt} query={matchedIds.has(prompt.id) ? query : ''} scope={{ provider, model, mode }} scopeName={scopeName} disabled={loading || Boolean(error)} onSaved={replace} onBusyChange={onBusyChange} />
              ))}
            </div>
          </section>
        </DevScope>
      ))}
    </DevScope>
  )
}

export default PromptsView
