const CHOICES = {
  reasoningEffort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  sandbox: ['read-only', 'workspace-write', 'danger-full-access'],
  approvalPolicy: ['on-request', 'never'],
  webSearch: ['disabled', 'cached', 'live'],
}

const normalizeCodexOptions = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('codex options must be an object')
  }
  const result = { sandbox: 'danger-full-access', approvalPolicy: 'never', webSearch: 'cached' }
  for (const [key, setting] of Object.entries(value)) {
    if (!Object.hasOwn(CHOICES, key)) throw new Error(`unknown Codex option: ${key}`)
    if (setting == null || setting === '') continue
    if (!CHOICES[key].includes(setting)) throw new Error(`invalid Codex ${key}: ${setting}`)
    result[key] = setting
  }
  return result
}

module.exports = { normalizeCodexOptions }
