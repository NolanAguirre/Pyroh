const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { readJson, readJsonAsync, writeJson } = require('./jsonFile')
const config = require('../config')
const { withQuestionLock, writeRecord } = require('./questionLifecycle')
const { createQuestionLifecycleConsumer } = require('../harness/questionLifecycleConsumer')
const { natsConfig } = require('../harness/natsConfig')

const optionLabel = (option) => {
  if (typeof option === 'string') return option
  if (typeof option === 'number') return String(option)
  if (option && typeof option === 'object') {
    const label = option.label ?? option.name ?? option.id
    return label == null ? '' : String(label)
  }
  return ''
}

const normalizeOptions = (options) =>
  Array.isArray(options) ? options.map(optionLabel) : []

const normalizeQuestion = (question) =>
  question ? { ...question, options: normalizeOptions(question.options) } : question

// Persist a pending question so the UI/API can surface it.
const writeQuestion = (sessionId, question, writeDir = config.writeDir) =>
  withQuestionLock(sessionId, question.id, writeDir, () => {
    const existing = loadQuestion(sessionId, question.id, writeDir)
    if (existing) return existing
    const record = {
      id: question.id,
      runId: question.runId || null,
      question: question.question,
      options: normalizeOptions(question.options),
      allowMultiple: Boolean(question.allowMultiple),
      allowFreeText: question.allowFreeText !== false,
      kind: question.kind || 'question',
      details: question.details || null,
      optionDescriptions: question.optionDescriptions || [],
      secret: Boolean(question.secret),
      status: 'pending',
      answer: null,
      createdAt: Date.now(),
    }
    return writeRecord(sessionId, record, writeDir)
  })

const loadQuestion = (sessionId, qid, writeDir) =>
  normalizeQuestion(readJson(paths.questionFile(sessionId, qid, writeDir), null))

const listQuestions = (sessionId, writeDir) => {
  const dir = paths.questionsDir(sessionId, writeDir)
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const questions = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.answer.json')) continue
    const q = normalizeQuestion(readJson(path.join(dir, name), null))
    if (q) {
      if (q.status === 'answered' && !q.answeredAt) {
        q.answeredAt = readJson(paths.answerFile(sessionId, q.id, writeDir), null)?.answeredAt
      }
      questions.push(q)
    }
  }
  questions.sort((a, b) => a.createdAt - b.createdAt)
  return questions
}

const listQuestionsAsync = async (sessionId, writeDir) => {
  const dir = paths.questionsDir(sessionId, writeDir)
  let names
  try {
    names = await fs.promises.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const questions = (await Promise.all(names
    .filter((name) => name.endsWith('.json') && !name.endsWith('.answer.json'))
    .map(async (name) => {
      const q = normalizeQuestion(await readJsonAsync(path.join(dir, name), null))
      if (q?.status === 'answered' && !q.answeredAt) {
        q.answeredAt = (await readJsonAsync(paths.answerFile(sessionId, q.id, writeDir), null))?.answeredAt
      }
      return q
    })))
    .filter(Boolean)
  questions.sort((a, b) => a.createdAt - b.createdAt)
  return questions
}

const findPending = (sessionId, runId, text, writeDir) =>
  listQuestions(sessionId, writeDir).find((q) =>
    q.status === 'pending' && q.runId === runId && q.question === text) || null

// Complete an answer interrupted between the answer file and question writes.
// The per-question lock also serializes API answers against daemon cancellation.
const withQuestion = (sessionId, qid, writeDir, change) =>
  withQuestionLock(sessionId, qid, writeDir, () => {
    let question = loadQuestion(sessionId, qid, writeDir)
    const saved = question?.status === 'pending' && readJson(paths.answerFile(sessionId, qid, writeDir))
    if (saved) {
      question = writeRecord(sessionId, {
        ...question, status: 'answered', answer: saved.answer, answeredAt: saved.answeredAt,
      }, writeDir)
    }
    return change(question)
  })

const closeQuestion = (sessionId, qid, status, writeDir) =>
  withQuestion(sessionId, qid, writeDir, question => {
    if (question?.status !== 'pending') return false
    writeRecord(sessionId, {
      ...question, status, [`${status}At`]: Date.now(),
      ...(status === 'expired' ? { expiryReason: 'Run owner was lost before the question was answered' } : {}),
    }, writeDir)
    return true
  })

const cancelPending = (sessionId, runId, writeDir = config.writeDir) => {
  for (const question of listQuestions(sessionId, writeDir)) {
    if (question.status !== 'pending' || question.runId !== runId) continue
    closeQuestion(sessionId, question.id, 'cancelled', writeDir)
  }
}

// Recovery holds the session lock, so only the explicitly excluded run can
// still own a waiter. Live questions have no arbitrary time-based expiry.
const expirePending = (sessionId, writeDir = config.writeDir, { excludeRunId } = {}) => {
  for (const question of listQuestions(sessionId, writeDir)) {
    if (question.status !== 'pending' || (excludeRunId && question.runId === excludeRunId)) continue
    closeQuestion(sessionId, question.id, 'expired', writeDir)
  }
}

// API/CLI answers and approvals share this disk commit and lifecycle signal.
const answer = (sessionId, qid, answerValue, writeDir = config.writeDir) =>
  withQuestion(sessionId, qid, writeDir, question => {
    if (!question || question.status !== 'pending') throw new Error('Question is no longer pending')
    if (question.allowFreeText === false && !question.options.includes(answerValue)) throw new Error('Choose one of the offered answers')
    const answeredAt = Date.now()
    writeRecord(sessionId, { ...question, status: 'answered', answer: answerValue, answeredAt }, writeDir, () => {
      writeJson(paths.answerFile(sessionId, qid, writeDir), { id: qid, answer: answerValue, answeredAt })
    })
    return answerValue
  })

const awaitAnswer = (sessionId, qid, writeDir = config.writeDir, { signal, signals = [] } = {}) =>
  new Promise((resolve, reject) => {
    const abortSignals = [...new Set([signal, ...signals].filter(Boolean))]
    let settled = false
    let consumer = null

    const cleanup = () => {
      for (const current of abortSignals) current.removeEventListener('abort', onAbort)
      consumer?.stop().catch(error => process.stderr.write(`question waiter shutdown: ${error.message}\n`))
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    const check = () => {
      if (settled) return
      const question = withQuestion(sessionId, qid, writeDir, current => current)
      if (!question) return finish(new Error('Question no longer exists'))
      if (question.status === 'answered') {
        const saved = readJson(paths.answerFile(sessionId, qid, writeDir))
        return finish(null, saved ? saved.answer : question.answer)
      }
      if (['cancelled', 'expired'].includes(question.status)) {
        finish(Object.assign(new Error(`Question ${question.status}`), {
          code: `QUESTION_${question.status.toUpperCase()}`,
        }))
      }
    }
    const onAbort = () => {
      if (settled) return
      try { closeQuestion(sessionId, qid, 'cancelled', writeDir) }
      catch (error) { return finish(error) }
      finish(new Error('aborted'))
    }

    try {
      for (const current of abortSignals) {
        if (current.aborted) return onAbort()
        current.addEventListener('abort', onAbort)
      }
      // Fast path for already settled disk records, even while NATS is down.
      check()
      if (settled) return
      consumer = createQuestionLifecycleConsumer({
        transport: natsConfig({ writeDir, dbPath: config.dbPath }),
        name: `harness-question-waiter-${qid}`,
        onEvent: async event => {
          if (event.sessionId === sessionId && event.questionId === qid) check()
        },
        // The subscription barrier precedes this second read on every connect.
        onReconnect: async () => { check() },
      })
      consumer.start()
    } catch (error) { finish(error) }
  })

module.exports = {
  writeQuestion,
  loadQuestion,
  listQuestions,
  listQuestionsAsync,
  findPending,
  cancelPending,
  expirePending,
  answer,
  awaitAnswer,
}
