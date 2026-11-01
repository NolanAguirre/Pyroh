const config = require('../config')
const prompts = require('../prompts')
const { DEVID_SERVER_NAME } = require('../agents/driver')

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

const actions = {
  devIds: {
    // mcpdevid records who each id was issued to from the URL path.
    mcpServers: (session) => {
      if (!config.devIdMcpUrl || !session.workspaceId) return []
      return [{ name: DEVID_SERVER_NAME, url: `${config.devIdMcpUrl}/mcp/${devIdRoute(session)}` }]
    },
    prepend: async (session) => {
      if (!config.devIdMcpUrl || !session.workspaceId) return null
      return prompts.render('devIds', { ids: await prefetchDevIds(session) })
    },
  },
}

// Each fired trigger id once, in match order, with its action.
const firedActions = (matches) => [...new Set(matches.map((match) => match.id))]
  .map((id) => actions[id])
  .filter(Boolean)

const triggerMcpServers = (fired, session) => fired.flatMap((action) => action.mcpServers?.(session) || [])

const prependNotes = async (fired, session, text) => {
  const notes = (await Promise.all(fired.map((action) => action.prepend?.(session)))).filter(Boolean)
  return notes.length ? `${notes.join('\n\n')}\n\n${text}` : text
}

module.exports = { actions, firedActions, triggerMcpServers, prependNotes }
