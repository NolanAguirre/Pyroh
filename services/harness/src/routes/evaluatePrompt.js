const config = require('../config')
const Harness = require('../harness/Harness')
const sessionStore = require('../store/sessionStore')
const workspaceStore = require('../store/workspaceStore')
const registry = require('../registry')
const { sessionModel } = require('../prompt/context')
const { evaluatePrompt } = require('../prompt/rewrite')
const { userPrompt } = require('../prompt/provenance')
const { actions, prependNotesWithProvenance } = require('../prompt/actions')
const { INPUT_COMMANDS, parseInputCommand } = require('../prompt/triggers')

const evaluatePromptRoute = async (req, res) => {
  try {
    const body = req.body || {}
    if (typeof body.prompt !== 'string') return res.status(400).json({ error: 'prompt must be a string' })
    for (const key of ['mode', 'provider', 'model', 'targetMode']) {
      if (body[key] != null && (typeof body[key] !== 'string' || !body[key].trim())) {
        return res.status(400).json({ error: `${key} must be a nonempty string` })
      }
    }
    if (body.steering != null && typeof body.steering !== 'boolean') {
      return res.status(400).json({ error: 'steering must be a boolean' })
    }
    const session = sessionStore.loadSession(req.params.id, config.writeDir)
    if (!session) return res.status(404).json({ error: 'session not found' })
    const command = parseInputCommand(body.prompt)
    if (command) {
      const entry = INPUT_COMMANDS.find(entry => entry.type === command.type)
      return res.json({ prompt: body.prompt, highlights: [], triggered: [{
        id: command.type, label: entry.label, description: entry.description, effect: 'command', matches: [],
      }] })
    }
    const workspace = registry.sessionWorkspace(session)
    const selected = registry.requireMode(workspace, body.mode || Harness.replyMode(session), { provider: session.provider })
    const continuation = selected.interaction === 'continuation'
    const fork = selected.interaction === 'fork'
    const spawning = !fork && (continuation || (selected.newSession && !Harness.repliesInPlace(session, selected)))
    const provider = spawning ? body.provider || session.provider : session.provider
    const entry = continuation
      ? registry.requireMode(workspace, body.targetMode || 'agent', { provider })
      : selected
    const first = !body.steering && !fork && (spawning || (!session.fork && !session.providerAgentId))
    const context = {
      provider,
      model: spawning ? body.model || (provider === session.provider ? sessionModel(session) : undefined) : sessionModel(session),
      mode: entry.id,
      first,
      terse: first && Boolean(entry.terse),
      textOnly: Array.isArray(entry.turnOverrides?.tools) && entry.turnOverrides.tools.length === 0,
      workspaceId: session.workspaceId,
      cwd: workspaceStore.resolveSessionCwd(session, config.writeDir),
      messageType: 'user',
    }
    // Evaluate rewrites without starting agents, allocating ids, or attaching tools.
    const result = await evaluatePrompt(userPrompt(body.prompt), context)
    const fired = result.triggered.filter(entry => entry.target === 'action' && entry.effect === 'applied')
      .map(entry => actions[entry.id]).filter(Boolean)
    const preview = await prependNotesWithProvenance(fired, { ...session, ...context }, result.prompt, { preview: true })
    return res.json({ prompt: preview.text, triggered: result.triggered, highlights: result.highlights })
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message || String(err) })
  }
}

module.exports = evaluatePromptRoute
