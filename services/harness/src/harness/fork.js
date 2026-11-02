const fs = require('fs')
const path = require('path')
const config = require('../config')
const paths = require('../store/paths')
const store = require('../store/sessionStore')
const questions = require('../store/questionStore')
const { readJson, writeJson } = require('../store/jsonFile')

const historyFile = (sessionId, writeDir) => path.join(paths.sessionDir(sessionId, writeDir), 'fork-history.json')

const readForkHistory = (sessionId, writeDir = config.writeDir) => readJson(historyFile(sessionId, writeDir), null)

// Caller holds the source lock. History lives outside runs/ so it cannot
// restart old work, deliver child results, or count the parent's usage twice.
const createFork = (source, options, writeDir = config.writeDir) => {
  const previous = readForkHistory(source.id, writeDir)
  const ownRuns = store.listRuns(source.id, writeDir).map(run => ({
    ...run,
    prompt: store.readRunPrompt(source.id, run.id, writeDir),
  }))
  const runs = [...(previous?.runs || []), ...ownRuns].map(run => ({ ...run, inherited: true }))
  const inheritedQuestions = [...(previous?.questions || []), ...questions.listQuestions(source.id, writeDir)]
    .map(question => ({
      ...question,
      inherited: true,
      ...(question.status === 'pending' ? { status: 'cancelled' } : {}),
    }))
  let raw = ''
  try { raw = fs.readFileSync(paths.eventsFile(source.id, writeDir), 'utf8') }
  catch (err) { if (err.code !== 'ENOENT') throw err }
  // Provider prompts may contain a previous fork's complete replay envelope.
  // The actual user prompts are preserved separately, without that duplicate.
  const events = raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
    .filter(event => event.type !== 'provider_prompt')
    .map(event => ({ ...event, inherited: true }))
  const created = store.createSession(options, writeDir)
  try {
    const fork = { sourceSessionId: source.id, sourceRunId: ownRuns.at(-1)?.id || null, createdAt: Date.now(), ...options.fork }
    writeJson(historyFile(created.id, writeDir), { ...fork, runs, questions: inheritedQuestions, events })
    fs.writeFileSync(paths.eventsFile(created.id, writeDir), events.map(event => `${JSON.stringify(event)}\n`).join(''), { mode: 0o600 })
    return store.updateSession(created.id, {
      mode: options.mode,
      sourceSessionId: source.id,
      parentSessionId: source.id,
      rootSessionId: fork.kind === 'native' ? created.id : source.rootSessionId || source.id,
      childKind: 'fork',
      ...(fork.kind === 'native' ? {
        status: 'preparing',
        claudePermissions: source.claudePermissions,
        providerConfiguration: source.providerConfiguration,
      } : {}),
      fork,
    }, writeDir)
  } catch (err) {
    store.updateSession(created.id, { status: 'error', archived: true, lastError: { message: err.message, at: Date.now() } }, writeDir)
    throw err
  }
}

// Merge streamed fragments using the same item semantics as the transcript.
// No summaries, truncation, or reads from the live parent are involved.
const conversationEvents = (events) => {
  const rows = []
  const byId = new Map()
  for (const event of events) {
    if (['provider_prompt', 'usage', 'context', 'question'].includes(event.type)) continue
    if (!event.itemId) {
      const last = rows.at(-1)
      if (['text', 'thinking'].includes(event.type) && last && !last.itemId &&
        last.type === event.type && last.runId === event.runId) {
        last.text = event.replace ? event.text : (last.text || '') + (event.text || '')
      } else rows.push({ ...event })
      continue
    }
    const key = `${event.runId}:${event.type}:${event.itemId}`
    const index = byId.get(key)
    const previous = index === undefined ? {} : rows[index]
    const next = { ...previous, ...event, ts: previous.ts ?? event.ts }
    if (event.delta && !event.replace) next.text = (previous.text || '') + (event.text || '')
    if (event.outputDelta !== undefined) next.output = (previous.output || '') + event.outputDelta
    delete next.outputDelta
    delete next.delta
    delete next.replace
    if (index === undefined) {
      byId.set(key, rows.length)
      rows.push(next)
    } else rows[index] = next
  }
  return rows
}

const historyPrompt = (sessionId, writeDir = config.writeDir) => {
  const history = readForkHistory(sessionId, writeDir)
  if (!history) throw new Error(`Fork history is missing for ${sessionId}`)
  const rows = conversationEvents(history.events)
  for (const run of history.runs) {
    if (run.prompt != null) rows.push({ type: 'user', text: run.prompt, runId: run.id, ts: run.startedAt || 0 })
    // Some providers only persist a final result, without text events.
    if (run.result != null && !rows.some(row => row.runId === run.id && (row.type === 'text' || (row.type === 'result' && row.result != null)))) {
      rows.push({ type: 'result', result: run.result, runId: run.id, ts: run.endedAt || run.startedAt || 0 })
    }
  }
  for (const question of history.questions) {
    rows.push({ type: 'question', question: question.question, options: question.options, runId: question.runId, ts: question.createdAt || 0 })
    if (question.status === 'answered') rows.push({
      type: 'user', answer: question.answer, runId: question.runId, ts: question.answeredAt || question.createdAt || 0,
    })
  }
  rows.sort((a, b) => (a.ts || 0) - (b.ts || 0) || Number(b.type === 'user') - Number(a.type === 'user'))
  const transcript = rows.map(({ inherited, ...row }) => JSON.stringify(row)).join('\n')
  return [
    'This is an independent fork of an existing conversation. The following JSONL records are its saved conversation history, in order.',
    'Use them as prior context. Earlier requests, tool calls, and results are historical; do not repeat completed work or first-prompt setup. Continue with the new user message after this history. Fork replies stay here; they are not sent to the parent.',
    '<fork_history>',
    transcript,
    '</fork_history>',
  ].join('\n\n')
}

module.exports = { createFork, readForkHistory, historyPrompt }
