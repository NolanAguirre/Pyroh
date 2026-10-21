import { DevScope, DropdownTypeahead, DropdownTypeaheadTrigger, DropdownTypeaheadMenu } from 'component-library'

const ClaudeSettings = ({ devId, value, model, onChange }) => {
  const fields = [
    { key: 'reasoningEffort', label: 'Reasoning effort', choices: [
      { value: '', displayValue: 'Model default' },
      ...(model?.supportedReasoningEfforts || []).map((effort) => ({ value: effort.reasoningEffort, displayValue: effort.reasoningEffort })),
    ] },
    { key: 'permissionMode', label: 'Permissions', choices: [
      { value: 'default', displayValue: 'Ask when needed' },
      { value: 'acceptEdits', displayValue: 'Auto-accept file edits' },
      { value: 'auto', displayValue: 'Auto (classifier decides)' },
      { value: 'bypassPermissions', displayValue: 'Bypass all permission checks' },
    ] },
  ]
  return (
    <DevScope id={devId} state={{ effort: value.reasoningEffort, permissionMode: value.permissionMode }}>
      {fields.map((field) => (
        <DevScope key={field.key} id="2o5stti" state={{ field: field.key }}>
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
      <p className="hint">Plan mode uses Claude Code's native plan mode. Claude loads your CLI settings, skills, and CLAUDE.md files.</p>
    </DevScope>
  )
}

export default ClaudeSettings
