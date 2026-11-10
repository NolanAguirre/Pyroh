const config = require('../config')
const prompts = require('../prompts')
const { sessionContext } = require('./context')
const { DEVID_SERVER_NAME } = require('../agents/driver')
const provenance = require('./provenance')
const { evaluateConditions } = require('./conditions')

// Server-side effects for triggers found by `findTriggers`, keyed by trigger
// id. mcpServers(session) returns { name, url } entries; prepend() resolves to
// a note placed before the prompt. Either may be omitted.
const PREFETCH_COUNT = 10
const PREFETCH_TIMEOUT_MS = 3000

const devIdRoute = (session) => [session.workspaceId, session.id].map(encodeURIComponent).join('/')

// Pre-issues ids so the agent rarely needs the MCP tool. Any failure yields
// 'none' and the agent falls back to get_dev_ids.
const prefetchDevIds = async (session) => {
  try {
    const res = await fetch(`${config.devIdMcpUrl}/ids/${devIdRoute(session)}?count=${PREFETCH_COUNT}`, {
      method: 'POST',
      signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
    })
    if (!res.ok) return 'none'
    const ids = await res.json()
    return Array.isArray(ids) && ids.length ? ids.join(', ') : 'none'
  } catch {
    return 'none'
  }
}

const instructionAction = id => {
  const prepend = (session, context = sessionContext(session)) => prompts.render(id, {}, session.provider, context)
  return { prepend, preview: prepend }
}

const actions = {
  toolkitTerminology: instructionAction('toolkitTerminology'),
  makefileRules: instructionAction('makefileRules'),
  makefileConventions: instructionAction('makefileConventions'),
  devIds: {
    // Preview describes the instructions without reserving ids on each keystroke.
    preview: (session, context = sessionContext(session)) => prompts.render('devIds', { ids: 'none' }, session.provider, context),
    // mcpdevid records who each id was issued to from the URL path.
    mcpServers: (session) => {
      if (!config.devIdMcpUrl || !session.workspaceId) return []
      return [{ name: DEVID_SERVER_NAME, url: `${config.devIdMcpUrl}/mcp/${devIdRoute(session)}` }]
    },
    prepend: async (session, context = sessionContext(session)) => {
      if (!config.devIdMcpUrl || !session.workspaceId) return null
      return prompts.render('devIds', { ids: await prefetchDevIds(session) }, session.provider, context)
    },
  },
}

// Each fired trigger id once, in match order, with its action.
const firedActions = (matches, provider, context = {}) => [...new Set(matches.map((match) => match.id))]
  .filter(id => prompts.appliesTo(id, provider, context))
  .map((id) => actions[id])
  .filter(Boolean)

const actionsForPrompt = (text, context = {}) => evaluateConditions(text, context)
  .filter(entry => entry.target === 'action' && entry.effect === 'applied')
  .map(entry => actions[entry.id])
  .filter(Boolean)

const triggerMcpServers = (fired, session) => fired.flatMap((action) => action.mcpServers?.(session) || [])

const prependNotesWithProvenance = async (fired, session, prompt, { preview = false, context = sessionContext(session) } = {}) => {
  const notes = (await Promise.all(fired.map(action => preview ? action.preview?.(session, context) : action.prepend?.(session, context)))).filter(Boolean)
  return provenance.prepend(notes.map(note => provenance.section('system', 'Harness trigger instructions', note)), prompt)
}

const prependNotes = async (fired, session, text) =>
  (await prependNotesWithProvenance(fired, session, provenance.supplied(text))).text

module.exports = { actions, firedActions, actionsForPrompt, triggerMcpServers, prependNotes, prependNotesWithProvenance }
