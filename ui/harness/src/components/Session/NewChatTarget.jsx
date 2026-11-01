import { DevScope, DropdownTypeahead, DropdownTypeaheadMenu, DropdownTypeaheadTrigger } from 'component-library'

const NewChatTarget = ({ providers, provider, model, onProvider, onModel, modes, targetMode, onTargetMode }) => {
  const current = providers.find((item) => item.id === provider)
  const providerOptions = providers.map((item) => ({
    value: item.id,
    displayValue: item.implemented ? item.id : `${item.id} (unavailable)`,
  }))
  const listed = (current?.models || []).map((entry) => ({
    value: entry.id,
    displayValue: entry.displayName || entry.id,
  }))
  const withCurrent = model && !listed.some((option) => option.value === model)
    ? [{ value: model, displayValue: model }, ...listed]
    : listed
  const modelOptions = withCurrent.length
    ? withCurrent
    : [{ value: '', displayValue: 'default' }]
  const modeOptions = (modes || [])
    .filter((item) => item.kind === 'turn')
    .map((item) => ({ value: item.id, displayValue: item.label }))

  return (
    <DevScope id="n8k3p1w" state={{ provider, model, targetMode }}>
      <div className="composer__spawn">
        {onTargetMode && (
          <DevScope id="n5t9r3m" state={{ targetMode }}>
            <div className="field composer__spawn-field">
              <span className="field__label">Spawn mode</span>
              <DropdownTypeahead
                defaultValue={targetMode}
                options={modeOptions}
                change={onTargetMode}
              >
                <DropdownTypeaheadTrigger />
                <DropdownTypeaheadMenu />
              </DropdownTypeahead>
            </div>
          </DevScope>
        )}
        <DevScope id="n2v6h4q" state={{ provider }}>
          <div className="field composer__spawn-field">
            <span className="field__label">Spawn provider</span>
            <DropdownTypeahead
              defaultValue={provider}
              options={providerOptions}
              change={onProvider}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>
        <DevScope id="n7m1c5d" state={{ model }}>
          <div className="field composer__spawn-field">
            <span className="field__label">Spawn model</span>
            <DropdownTypeahead
              key={provider}
              defaultValue={model || modelOptions[0]?.value || ''}
              options={modelOptions}
              change={onModel}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>
        {current?.error ? <p className="hint hint--error">{current.error}</p> : null}
        {current && current.implemented === false ? (
          <p className="hint hint--warn">This provider is not implemented yet.</p>
        ) : null}
      </div>
    </DevScope>
  )
}

export default NewChatTarget
