const CHOICES = {
  reasoningEffort: ['low', 'medium', 'high', 'xhigh'],
}

const normalizeGrokOptions = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('grok options must be an object')
  }
  const result = {}
  for (const [key, setting] of Object.entries(value)) {
    if (!Object.hasOwn(CHOICES, key)) throw new Error(`unknown Grok option: ${key}`)
    if (setting == null || setting === '') continue
    if (!CHOICES[key].includes(setting)) throw new Error(`invalid Grok ${key}: ${setting}`)
    result[key] = setting
  }
  return result
}

module.exports = { normalizeGrokOptions }
