const CHOICES = {
  reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'],
  permissionMode: ['default', 'acceptEdits', 'auto', 'bypassPermissions'],
}

const normalizeClaudeOptions = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('claude options must be an object')
  }
  const result = {}
  for (const [key, setting] of Object.entries(value)) {
    if (!Object.hasOwn(CHOICES, key)) throw new Error(`unknown Claude option: ${key}`)
    if (setting == null || setting === '') continue
    if (!CHOICES[key].includes(setting)) throw new Error(`invalid Claude ${key}: ${setting}`)
    result[key] = setting
  }
  return result
}

module.exports = { normalizeClaudeOptions }
