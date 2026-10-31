const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const config = require('./config')

// Session ids become path segments, so they must not contain separators or dots.
const SESSION_ID = /^[A-Za-z0-9_-]+$/

const isSessionId = (value) => typeof value === 'string' && SESSION_ID.test(value)

const genId = () => `m_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

// <writeDir>/<sourceSessionId>/<memorySessionId>/<memoryId>.json
const memoriesDir = (sourceSessionId, memorySessionId, writeDir = config.writeDir) =>
  path.join(writeDir, sourceSessionId, memorySessionId)

const writeMemory = async ({ sourceSessionId, memorySessionId, title, content, evidence }) => {
  if (!isSessionId(sourceSessionId)) throw new Error(`invalid source session id: ${sourceSessionId}`)
  if (!isSessionId(memorySessionId)) throw new Error(`invalid memory session id: ${memorySessionId}`)
  const id = genId()
  const dir = memoriesDir(sourceSessionId, memorySessionId)
  const file = path.join(dir, `${id}.json`)
  const memory = {
    id,
    title,
    content,
    evidence: evidence || null,
    sourceSessionId,
    memorySessionId,
    createdAt: Date.now(),
  }
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${id}.${process.pid}.tmp`)
  await fs.writeFile(tmp, `${JSON.stringify(memory, null, 2)}\n`)
  await fs.rename(tmp, file)
  return { id, path: file }
}

module.exports = { isSessionId, memoriesDir, writeMemory }
