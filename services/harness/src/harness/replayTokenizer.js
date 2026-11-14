const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SERIALIZATION = 'harness-messages-json-v1'
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const serialize = value => JSON.stringify(canonical(value))
const fingerprint = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : serialize(value)).digest('hex')
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

const createReplayTokenizer = () => {
  const encoders = new Map()
  const cache = new Map()
  const identities = new Map()
  let library
  let version = null
  let unavailable = null
  try {
    library = require('js-tiktoken')
    let dir = path.dirname(require.resolve('js-tiktoken'))
    while (path.dirname(dir) !== dir) {
      const file = path.join(dir, 'package.json')
      if (fs.existsSync(file)) {
        const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (metadata.name === 'js-tiktoken') { version = metadata.version; break }
      }
      dir = path.dirname(dir)
    }
  } catch (error) { unavailable = `CPU tokenizer unavailable: ${error.message}` }
  const identify = model => {
    const name = String(model || 'unknown').toLowerCase()
    const modern = /^(?:gpt-4o|gpt-4\.1|gpt-5|o[134](?:-|$))/.test(name)
    const legacy = /^(?:gpt-3\.5|gpt-4(?:-|$))/.test(name)
    const encoding = legacy ? 'cl100k_base' : 'o200k_base'
    const identity = { package: 'js-tiktoken', version, model, encoding,
      approximation: !modern && !legacy,
      reason: modern || legacy ? 'Model-family encoding, approximate provider message serialization.'
        : 'Proxy encoding: no supported public tokenizer mapping for this model.',
      serialization: SERIALIZATION, unavailable }
    identities.set(String(model), identity)
    return identity
  }
  const count = (text, model, serialization = SERIALIZATION) => {
    const identity = identify(model)
    const hash = fingerprint(text)
    const key = `${identity.version}:${identity.encoding}:${serialization}:${hash}`
    if (unavailable) return { tokens: null, fingerprint: hash, identity }
    if (!cache.has(key)) {
      try {
        if (!encoders.has(identity.encoding)) encoders.set(identity.encoding, library.getEncoding(identity.encoding))
        // Transcript text can contain literal special-token spellings.
        cache.set(key, encoders.get(identity.encoding).encode(text, [], []).length)
      } catch (error) {
        unavailable = `Tokenization failed: ${error.message}`
        return { tokens: null, fingerprint: hash, identity: { ...identity, unavailable } }
      }
    }
    return { tokens: cache.get(key), fingerprint: hash, identity }
  }
  const request = (blocks, model) => count(serialize(blocks.map(block => ({ role: block.role,
    type: block.kind, ...(block.name ? { name: block.name } : {}),
    ...(block.toolId ? { tool_call_id: block.toolId } : {}), content: block.content }))), model)
  const output = (blocks, model) => count(blocks.filter(block => block.generated).map(block =>
    typeof block.content === 'string' ? block.content : serialize(block.content)).join('\n'), model, 'generated-text-v1')
  return { request, output, identities: () => [...identities.values()], cacheSize: () => cache.size }
}

module.exports = { createReplayTokenizer, serialize, fingerprint, freeze }
