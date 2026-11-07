const crypto = require('crypto')

const section = (kind, label, text) => ({ kind, label, text: text == null ? '' : String(text) })
const assemble = (sections, metadata = {}) => ({
  ...metadata,
  text: sections.map(part => part.text).join(''),
  sections: sections.map(part => ({ ...part })),
})

// Unknown callers may supply generated instructions or mixed content. Do not
// guess provenance by inspecting their text or claim a missing original input.
const supplied = (text, provenance) => {
  text = text == null ? '' : String(text)
  const metadata = {}
  for (const key of ['originalText', 'rewrittenText', 'userItemId']) {
    if (typeof provenance?.[key] === 'string') metadata[key] = provenance[key]
  }
  const parts = provenance?.sections
  const valid = Array.isArray(parts) && parts.every(part => part &&
    ['system', 'user', 'rewritten', 'context'].includes(part.kind) &&
    typeof part.label === 'string' && typeof part.text === 'string') &&
    parts.map(part => part.text).join('') === text
  return assemble(valid ? parts : [section('context', 'Supplied prompt (source unavailable)', text)], metadata)
}

const userPrompt = (text, originalText) => assemble([
  section(typeof originalText === 'string' && text !== originalText ? 'rewritten' : 'user',
    typeof originalText === 'string' && text !== originalText ? 'Rewritten user text' : 'User text', text),
], typeof originalText === 'string' ? {
  originalText,
  ...(text !== originalText ? { rewrittenText: text } : {}),
} : {})

const prepend = (parts, prompt) => assemble([
  ...parts.map(part => ({ ...part, text: `${part.text}\n\n` })),
  ...prompt.sections,
], prompt)

const slice = (prompt, start, end) => {
  let offset = 0
  return prompt.sections.flatMap(part => {
    const from = Math.max(0, start - offset)
    const to = Math.min(part.text.length, end - offset)
    offset += part.text.length
    return to > from ? [{ ...part, text: part.text.slice(from, to) }] : []
  })
}

const capture = (prompt, fields = {}) => {
  const snapshot = supplied(prompt.text, prompt)
  const event = { ...fields, ...snapshot, type: 'provider_prompt', captureId: crypto.randomUUID(), capturedAt: Date.now() }
  event.sections = Object.freeze(event.sections.map(part => Object.freeze(part)))
  return Object.freeze(event)
}

module.exports = { section, assemble, supplied, userPrompt, prepend, slice, capture }
