import { DevScope, DropdownTypeahead, DropdownTypeaheadTrigger, DropdownTypeaheadMenu } from 'component-library'

const GrokSettings = ({ devId, value, model, onChange }) => {
  const choices = [
    { value: '', displayValue: `Model default${model?.defaultReasoningEffort ? ` (${model.defaultReasoningEffort})` : ''}` },
    ...(model?.supportedReasoningEfforts || []).map((effort) => ({ value: effort.reasoningEffort, displayValue: effort.reasoningEffort })),
  ]
  return (
    <DevScope id={devId} state={{ effort: value.reasoningEffort }}>
      <DevScope id="k7w2p9d" state={{ field: 'reasoningEffort' }}>
        <div className="field">
          <span className="field__label">Reasoning effort</span>
          <DropdownTypeahead
            key={`${value.reasoningEffort || ''}:${model?.id || ''}`}
            defaultValue={value.reasoningEffort || ''}
            options={choices}
            change={(setting) => onChange({ ...value, reasoningEffort: setting })}
          >
            <DropdownTypeaheadTrigger />
            <DropdownTypeaheadMenu />
          </DropdownTypeahead>
        </div>
      </DevScope>
      <p className="hint">Plan mode uses Grok's native plan mode. Grok loads your CLI settings and project instructions.</p>
    </DevScope>
  )
}

export default GrokSettings
