const fs = require('fs')
const paths = require('../store/paths')
const { TEMPLATES } = require('../prompts/templates')
const prompts = require('../prompts')
const { sessionContext } = require('./context')

const promptIds = prompt => [...new Set((prompt?.sections || [])
  .filter(part => part.kind === 'system' && typeof part.promptId === 'string' && part.text.trim())
  .map(part => part.promptId))]

// Old captures have labels but no IDs. Only recognize exact instruction text
// for the shared action label, never matches in user-supplied text.
const legacyPromptIds = (capture, session) => (capture.sections || []).flatMap(part => {
  if (part.kind !== 'system' || !part.text?.trim()) return []
  if (part.promptId) return [part.promptId]
  return TEMPLATES.filter(entry => {
    if (!entry.firstMessage && !entry.usedBy.includes('prompt/actions.js')) return false
    if (part.label === entry.name) return true
    if (part.label !== 'Harness trigger instructions' || entry.vars.length) return false
    const text = part.text.trim()
    return text === entry.template.trim()
      || text === prompts.text(entry.id, session.provider, sessionContext(session)).trim()
  }).map(entry => entry.id)
})

const appliedPromptIds = (session, writeDir, { fresh = false } = {}) => {
  if (!session || (fresh && session.fork?.kind !== 'native')) return []
  const saved = session.promptInclusions
  if (saved?.provider === session.provider && saved.providerAgentId === session.providerAgentId) return saved.ids || []
  const ids = new Set(session.fork?.kind === 'native' ? session.fork.appliedPromptIds || [] : [])
  if (!session.providerAgentId) return [...ids]
  let raw
  try { raw = fs.readFileSync(paths.eventsFile(session.id, writeDir), 'utf8') }
  catch (err) {
    if (err.code !== 'ENOENT') throw err
    return [...ids]
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type !== 'provider_prompt' || event.provider !== session.provider
      || event.providerAgentId !== session.providerAgentId || event.inherited) continue
    for (const id of legacyPromptIds(event, session)) ids.add(id)
  }
  return [...ids]
}

module.exports = { promptIds, appliedPromptIds }
