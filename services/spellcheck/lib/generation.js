const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const QUEUE_DIR = process.env.QUEUE_DIR
const GENERATION_TIMEOUT_SECONDS = Number(process.env.GENERATION_TIMEOUT_SECONDS || 900)
const GENERATION_MAX_NEW_TOKENS = Number(process.env.GENERATION_MAX_NEW_TOKENS || 16384)
const RETENTION_MS = 24 * 60 * 60 * 1000
const JOB_ID = /^generate__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

if (!Number.isSafeInteger(GENERATION_TIMEOUT_SECONDS) || GENERATION_TIMEOUT_SECONDS < 1) {
  throw new Error('GENERATION_TIMEOUT_SECONDS must be a positive integer')
}
if (!Number.isSafeInteger(GENERATION_MAX_NEW_TOKENS) || GENERATION_MAX_NEW_TOKENS < 1) {
  throw new Error('GENERATION_MAX_NEW_TOKENS must be a positive integer')
}

const requireQueueDir = () => {
  if (!QUEUE_DIR) throw new Error('QUEUE_DIR is not set')
  return QUEUE_DIR
}

const isGenerationId = (id) => typeof id === 'string' && JOB_ID.test(id)

const validateGeneration = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object'
  const { messages, max_new_tokens: maxNewTokens, timeout_seconds: timeoutSeconds } = body
  if (!Array.isArray(messages) || !messages.length || messages.length > 128) {
    return 'messages must contain 1 to 128 messages'
  }
  for (const [index, message] of messages.entries()) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
      return 'each message must have a system, user or assistant role'
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      return 'each message must have nonempty string content'
    }
    if (message.role === 'system' && index !== 0) return 'system messages must be first'
  }
  if (messages.at(-1).role !== 'user') return 'the last message must have the user role'
  if (maxNewTokens !== undefined && (!Number.isSafeInteger(maxNewTokens) || maxNewTokens < 1 || maxNewTokens > GENERATION_MAX_NEW_TOKENS)) {
    return `max_new_tokens must be an integer from 1 to ${GENERATION_MAX_NEW_TOKENS}`
  }
  if (timeoutSeconds !== undefined && (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > GENERATION_TIMEOUT_SECONDS)) {
    return `timeout_seconds must be an integer from 1 to ${GENERATION_TIMEOUT_SECONDS}`
  }
  return null
}

const enqueueGeneration = async ({ messages, max_new_tokens: maxNewTokens, timeout_seconds: timeoutSeconds }) => {
  const queueDir = requireQueueDir()
  const id = `generate__${randomUUID()}`
  const now = Date.now()
  const descriptor = {
    id,
    type: 'generate',
    messages: messages.map(({ role, content }) => ({ role, content })),
    max_new_tokens: maxNewTokens ?? null,
    enqueued_at: new Date(now).toISOString(),
    expires_at: new Date(now + (timeoutSeconds ?? GENERATION_TIMEOUT_SECONDS) * 1000).toISOString(),
  }
  const temporary = path.join(queueDir, 'tmp', `${id}.json.tmp`)
  await fs.promises.mkdir(path.dirname(temporary), { recursive: true })
  await fs.promises.mkdir(path.join(queueDir, 'pending'), { recursive: true })
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(descriptor), { mode: 0o660, flag: 'wx' })
    await fs.promises.rename(temporary, path.join(queueDir, 'pending', `${id}.json`))
  } finally {
    await fs.promises.unlink(temporary).catch(() => {})
  }
  return { id, state: 'pending' }
}

const readGeneration = async (id) => {
  if (!isGenerationId(id)) throw new Error('Invalid generation job id')
  const queueDir = requireQueueDir()
  // Follow the order of queue moves so a transition cannot hide a job.
  for (const state of ['pending', 'processing', 'done', 'failed']) {
    let raw
    try {
      raw = await fs.promises.readFile(path.join(queueDir, state, `${id}.json`), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    const job = JSON.parse(raw)
    if (state === 'failed' || job.result?.error) {
      return { id, state: 'failed', error: job.result?.error || 'Generation consumer failed before writing a result' }
    }
    if (state === 'done') {
      if (typeof job.result?.text !== 'string') return { id, state: 'failed', error: 'Generation returned no text' }
      return { id, state, result: job.result }
    }
    if (Date.parse(job.expires_at) <= Date.now()) {
      return { id, state: 'failed', error: 'Generation exceeded its overall timeout' }
    }
    return { id, state }
  }
  return null
}

const sweepGenerations = async () => {
  const queueDir = requireQueueDir()
  const cutoff = Date.now() - RETENTION_MS
  for (const state of ['done', 'failed']) {
    const dir = path.join(queueDir, state)
    const names = await fs.promises.readdir(dir).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const name of names) {
      if (!name.endsWith('.json') || !isGenerationId(name.slice(0, -5))) continue
      const file = path.join(dir, name)
      try {
        if ((await fs.promises.stat(file)).mtimeMs < cutoff) await fs.promises.unlink(file)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
}

module.exports = { enqueueGeneration, readGeneration, validateGeneration, isGenerationId, sweepGenerations }
