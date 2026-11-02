const crypto = require('crypto')

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
  return value
}
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

// Callbacks cannot be persisted; their presence determines provider tool definitions.
const snapshot = (provider, settings, tools, extras = {}) => ({
  provider,
  settings,
  tools: { ...tools, askUser: undefined, askUserEnabled: typeof tools.askUser === 'function' },
  ...extras,
})

const compare = (source, current) => ({
  sourceKnown: Boolean(source),
  sourceFingerprint: source ? fingerprint(source) : null,
  fingerprint: fingerprint(current),
  mcpEndpointsChanged: source ? fingerprint(source.tools?.mcpServers || []) !== fingerprint(current.tools?.mcpServers || []) : null,
  toolConfigurationChanged: source ? fingerprint({ ...source.tools, mcpServers: undefined }) !== fingerprint({ ...current.tools, mcpServers: undefined }) : null,
  // Providers do not expose their serialized cache prefix. Configuration changes
  // are evidence of possible prefix changes, not proof of a cache hit or miss.
  prefixImpact: 'unknown',
})

module.exports = { snapshot, compare, fingerprint }
