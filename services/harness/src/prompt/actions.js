const config = require('../config')
const prompts = require('../prompts')
const { DEVID_SERVER_NAME } = require('../agents/driver')

// Server-side effects for triggers found by `findTriggers`, keyed by trigger
// id. mcpServers(session) returns { name, url } entries; prepend() returns a
// note placed before the prompt. Either may be omitted.
const actions = {
  devIds: {
    // mcpdevid records who each id was issued to from the URL path.
    mcpServers: (session) => {
      if (!config.devIdMcpUrl || !session.workspaceId) return []
      const route = [session.workspaceId, session.id].map(encodeURIComponent).join('/')
      return [{ name: DEVID_SERVER_NAME, url: `${config.devIdMcpUrl}/mcp/${route}` }]
    },
    prepend: (session) => (config.devIdMcpUrl && session.workspaceId ? prompts.text('devIds') : null),
  },
}

// Each fired trigger id once, in match order, with its action.
const firedActions = (matches) => [...new Set(matches.map((match) => match.id))]
  .map((id) => actions[id])
  .filter(Boolean)

const triggerMcpServers = (fired, session) => fired.flatMap((action) => action.mcpServers?.(session) || [])

const prependNotes = (fired, session, text) => {
  const notes = fired.map((action) => action.prepend?.(session)).filter(Boolean)
  return notes.length ? `${notes.join('\n\n')}\n\n${text}` : text
}

module.exports = { actions, firedActions, triggerMcpServers, prependNotes }
