const DRAFTS_KEY = 'harness.composerDrafts'

export const readDrafts = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || 'null')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

const writeDrafts = (drafts) => {
  try {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // ignore quota and private-mode failures
  }
}

// Plugin modes load later, so any mode id is kept until the registry says otherwise.
const isMode = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value)

const sharedPrompt = (entry, mode) => {
  if (!entry) return ''
  if (typeof entry.prompt === 'string') return entry.prompt
  const prompts = entry.prompts && typeof entry.prompts === 'object' ? entry.prompts : null
  if (!prompts) return ''
  const current = prompts[mode]
  if (typeof current === 'string' && current) return current
  return Object.values(prompts).find((text) => typeof text === 'string' && text) || ''
}

// Replies stay in the mode the session was spawned in. Decompose is a pipeline, not a reply.
export const replyMode = (session) =>
  session?.mode && session.mode !== 'decompose' ? session.mode : 'agent'

export const loadComposer = (sessionId, fallbackMode) => {
  const entry = sessionId ? readDrafts()[sessionId] : null
  const mode = entry && isMode(entry.mode) ? entry.mode : fallbackMode
  return { mode, prompt: sharedPrompt(entry, mode) }
}

export const saveComposer = (sessionId, mode, prompt, fallbackMode) => {
  if (!sessionId) return
  const drafts = readDrafts()
  const text = typeof prompt === 'string' ? prompt : ''
  if (!text && mode === fallbackMode) delete drafts[sessionId]
  else drafts[sessionId] = { mode, prompt: text }
  writeDrafts(drafts)
}
