const config = require('../config')
const Harness = require('../harness/Harness')
const sessionStore = require('../store/sessionStore')
const registry = require('../registry')
const { INPUT_COMMANDS, parseInputCommand } = require('../prompt/triggers')
const { executeInputCommand } = require('../harness/inputCommands')
const { correctText } = require('../spellcheck')

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

// Shared by the original HTTP routes and durable background submissions.
const inputCommand = (sessionId, { prompt } = {}) => {
  const command = parseInputCommand(prompt)
  if (!command) return null
  const at = new Date().toISOString()
  try {
    const session = sessionStore.loadSession(sessionId, config.writeDir)
    if (!session) throw fail('session not found', 404)
    return { status: 200, body: executeInputCommand({ session, prompt, command, at }) }
  } catch (err) {
    if (!err.status) err.status = 500
    throw err
  }
}

const startRun = async (sessionId, requested, { prompt, provider, model, targetMode, runAfterSessionId, forkRetryKey }) => {
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) throw fail('session not found', 404)
  const mode = requested || Harness.replyMode(session)
  const entry = registry.requireMode(registry.sessionWorkspace(session), mode, { provider: session.provider })
  const inPlace = Harness.repliesInPlace(session, entry)
  if (!prompt && (inPlace || !entry.promptOptional)) throw fail('prompt is required')
  try {
    const run = await Harness.run(sessionId, {
      prompt: await correctText(prompt), mode, provider, model, targetMode, runAfterSessionId, forkRetryKey,
    })
    if (run && run.queued) return { status: 202, body: { session: run.session } }
    if (entry.kind === 'decompose') return { status: 202, body: run }
    return { status: 202, body: { run, ...(entry.newSession && !inPlace
      ? { session: sessionStore.loadSession(run.sessionId, config.writeDir) } : {}) } }
  } catch (err) {
    if (!err.status) err.status = String(err.message || err).includes('not found') ? 404 : 400
    throw err
  }
}

const execute = async (sessionId, action, body = {}) => {
  const command = inputCommand(sessionId, body)
  if (command) return command
  if (action === 'commands') throw fail(`Expected command: ${INPUT_COMMANDS.map(command => command.usage).join(', ')}`)
  if (['run', 'plan', 'decompose'].includes(action)) {
    return startRun(sessionId, action === 'run' ? body.mode : action, body)
  }
  const { prompt, mode } = body
  if (typeof prompt !== 'string' || !prompt.trim()) throw fail('prompt is required')
  if (action === 'steer') {
    const corrected = await correctText(prompt, { first: false })
    return { status: 202, body: { steer: await Harness.steer(sessionId, corrected) } }
  }
  if (action === 'queue') {
    if (mode != null && typeof mode !== 'string') throw fail('mode must be a string')
    const message = await Harness.queue(sessionId, { prompt: await correctText(prompt), mode })
    return { status: 202, body: { message } }
  }
  throw fail('unknown submission action')
}

module.exports = { execute, inputCommand }
