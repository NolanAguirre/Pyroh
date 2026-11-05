const config = require('../config')
const sessionStore = require('../store/sessionStore')
const sessionLock = require('../store/sessionLock')
const eventLog = require('../store/eventLog')
const checkpointStore = require('../store/checkpointStore')
const { inputCommandHelp } = require('../prompt/triggers')
const { analyzeSubagents, parseAssumptions } = require('./subagentAnalysis')

// Local replies use the same saved runs and normalized events as agent turns.
const writeReply = (session, prompt, reply, localCommand = 'help') => {
  const writeDir = config.writeDir
  const lock = sessionLock.acquire(session.id, writeDir, { exclusive: true })
  let run
  try {
    sessionStore.recoverSession(session.id, writeDir)
    // Capture analysis before creating its own local run.
    const text = typeof reply === 'function' ? reply() : reply
    run = sessionStore.createRun(session.id, { mode: 'agent', prompt, localCommand }, writeDir)
    eventLog.append(session.id, { type: 'text', runId: run.id, itemId: `${run.id}:reply`, text }, writeDir)
    const endedAt = Date.now()
    const usage = sessionStore.emptyTotals().tokens
    const durationMs = endedAt - run.startedAt
    eventLog.append(session.id, {
      type: 'result', runId: run.id, status: 'completed', result: text, usage, durationMs,
    }, writeDir)
    const completed = sessionStore.updateRun(session.id, run.id, {
      status: 'completed', result: text, endedAt, durationMs, usage,
    }, writeDir)
    const updated = sessionStore.updateSession(session.id, {}, writeDir)
    return { run: completed, session: updated }
  } catch (err) {
    if (run) sessionStore.updateRun(session.id, run.id, {
      status: 'error', error: err.message, endedAt: Date.now(),
    }, writeDir)
    throw err
  } finally {
    lock.release()
  }
}

const handlers = {
  help: ({ session, prompt }) => writeReply(session, prompt, inputCommandHelp()),
  'analyze-subagent': ({ session, prompt, command }) => {
    const assumptions = parseAssumptions(command.assumptions)
    return writeReply(session, prompt,
      () => analyzeSubagents(session, config.writeDir, assumptions), 'analyze-subagent')
  },
  'create-checkpoint': ({ session, command, at }) => {
    const checkpoint = checkpointStore.create({ name: command.name, sessionId: session.id, at })
    return { checkpoint, message: `Created checkpoint "${checkpoint.name}".` }
  },
}

const executeInputCommand = ({ session, prompt, command, at }) => {
  const handler = handlers[command.type]
  if (!handler) throw Object.assign(new Error(`Unknown command: ${command.type}`), { status: 400 })
  return { command: command.type, ...handler({ session, prompt, command, at }) }
}

module.exports = { executeInputCommand }
