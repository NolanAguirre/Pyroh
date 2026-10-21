import { DevScope, DropdownTypeahead, DropdownTypeaheadTrigger, DropdownTypeaheadMenu } from 'component-library'

const CodexSettings = ({ devId, value, model, onChange }) => {
  const fields = [
    { key: 'reasoningEffort', label: 'Reasoning effort', choices: [
      { value: '', displayValue: `Model default${model?.defaultReasoningEffort ? ` (${model.defaultReasoningEffort})` : ''}` },
      ...(model?.supportedReasoningEfforts || []).map((effort) => ({ value: effort.reasoningEffort, displayValue: effort.reasoningEffort })),
    ] },
    { key: 'sandbox', label: 'File access', choices: [
      { value: 'read-only', displayValue: 'Read only' },
      { value: 'workspace-write', displayValue: 'Write in workspace' },
      { value: 'danger-full-access', displayValue: 'Full system access' },
    ] },
    { key: 'approvalPolicy', label: 'Execution approvals', choices: [
      { value: 'on-request', displayValue: 'Ask when needed' },
      { value: 'never', displayValue: 'Never ask (deny requests for extra access)' },
    ] },
    { key: 'webSearch', label: 'Web search', choices: [
      { value: 'disabled', displayValue: 'Disabled' },
      { value: 'cached', displayValue: 'Cached' },
      { value: 'live', displayValue: 'Live' },
    ] },
  ]
  return (
    <DevScope id={devId} state={{ effort: value.reasoningEffort, sandbox: value.sandbox }}>
      {fields.map((field) => (
        <DevScope key={field.key} id="y6g2s9k" state={{ field: field.key }}>
          <div className="field">
            <span className="field__label">{field.label}</span>
            <DropdownTypeahead
              key={`${field.key}:${value[field.key] || ''}:${model?.id || ''}`}
              defaultValue={value[field.key] || ''}
              options={field.choices}
              change={(setting) => onChange({ ...value, [field.key]: setting })}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>
      ))}
      <p className="hint">Plan mode uses read-only access. Codex loads your CLI settings, skills, and project instructions.</p>
    </DevScope>
  )
}

export default CodexSettings
