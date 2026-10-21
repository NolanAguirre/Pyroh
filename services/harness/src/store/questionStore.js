const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { readJson, readJsonAsync, writeJson, ensureDir } = require('./jsonFile')

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
const writeQuestion = (sessionId, question, writeDir) => {
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
  writeJson(paths.questionFile(sessionId, question.id, writeDir), record)
  return record
}

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
    if (q) questions.push(q)
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
    .map(async (name) => normalizeQuestion(await readJsonAsync(path.join(dir, name), null)))))
    .filter(Boolean)
  questions.sort((a, b) => a.createdAt - b.createdAt)
  return questions
}

// Called by the API/CLI: record the answer file and mark the question answered.
const answer = (sessionId, qid, answerValue, writeDir) => {
  const q = loadQuestion(sessionId, qid, writeDir)
  if (!q || q.status !== 'pending') throw new Error('Question is no longer pending')
  if (q.allowFreeText === false && !q.options.includes(answerValue)) throw new Error('Choose one of the offered answers')
  const file = paths.answerFile(sessionId, qid, writeDir)
  ensureDir(path.dirname(file))
  writeJson(file, { id: qid, answer: answerValue, answeredAt: Date.now() })
  if (q) {
    writeJson(paths.questionFile(sessionId, qid, writeDir), {
      ...q,
      status: 'answered',
      answer: answerValue,
    })
  }
  return answerValue
}

// Called inside the daemon's ask_user tool: block until the answer file appears.
// Uses fs.watch on the questions dir with a polling fallback.
const awaitAnswer = (sessionId, qid, writeDir, { signal, signals = [] } = {}) =>
  new Promise((resolve, reject) => {
    const abortSignals = [signal, ...signals].filter(Boolean)
    const answerPath = paths.answerFile(sessionId, qid, writeDir)
    const dir = paths.questionsDir(sessionId, writeDir)
    ensureDir(dir)

    let settled = false
    let watcher = null
    let timer = null

    const cleanup = () => {
      if (watcher) {
        try {
          watcher.close()
        } catch {
          // ignore
        }
        watcher = null
      }
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      for (const current of abortSignals) current.removeEventListener('abort', onAbort)
    }

    const check = () => {
      if (settled) return
      const record = readJson(answerPath, null)
      if (record) {
        settled = true
        cleanup()
        resolve(record.answer)
      }
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      const q = loadQuestion(sessionId, qid, writeDir)
      if (q?.status === 'pending') writeJson(paths.questionFile(sessionId, qid, writeDir), { ...q, status: 'cancelled' })
      reject(new Error('aborted'))
    }

    for (const current of abortSignals) {
      if (current.aborted) return onAbort()
      current.addEventListener('abort', onAbort)
    }

    try {
      watcher = fs.watch(dir, () => check())
    } catch {
      // fs.watch unsupported on this platform; polling covers it.
    }
    timer = setInterval(check, 500)
    check()
  })

module.exports = {
  writeQuestion,
  loadQuestion,
  listQuestions,
  listQuestionsAsync,
  answer,
  awaitAnswer,
}
