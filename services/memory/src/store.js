const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const config = require('./config')

// Ids become path segments, so they must not contain separators or dots.
const SEGMENT_ID = /^[A-Za-z0-9_-]+$/

const isSegmentId = (value) => typeof value === 'string' && SEGMENT_ID.test(value)

const genId = () => `m_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`

const httpError = (status, message) => Object.assign(new Error(message), { httpStatus: status })

const requireId = (value, label) => {
  if (!isSegmentId(value)) throw httpError(400, `invalid ${label}: ${value}`)
  return value
}

const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw httpError(400, `${label} is required`)
  return value
}

const optionalText = (value, label) => {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw httpError(400, `${label} must be a string`)
  return value
}

// <writeDir>/<sourceSessionId>/<memorySessionId>/<memoryId>.json
const memoriesDir = (sourceSessionId, memorySessionId) =>
  path.join(config.writeDir, sourceSessionId, memorySessionId)

const readDirs = async (dir) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && isSegmentId(e.name)).map((e) => e.name)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readMemoryFile = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    console.error(`skipping unreadable memory ${file}: ${err.message}`)
    return null
  }
}

const readMemories = async (dir) => {
  let names
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const files = names.filter((n) => !n.startsWith('.') && n.endsWith('.json'))
  const memories = await Promise.all(files.map((n) => readMemoryFile(path.join(dir, n))))
  return memories.filter(Boolean)
}

// Yields { file, sourceSessionId, memorySessionId } for every memory file.
const locate = async ({ sourceSessionId, memorySessionId } = {}) => {
  const sources = sourceSessionId ? [requireId(sourceSessionId, 'source session id')] : await readDirs(config.writeDir)
  const pairs = []
  for (const source of sources) {
    const sessions = memorySessionId
      ? [requireId(memorySessionId, 'memory session id')]
      : await readDirs(path.join(config.writeDir, source))
    for (const session of sessions) pairs.push(memoriesDir(source, session))
  }
  return pairs
}

const listMemories = async (filter = {}) => {
  const dirs = await locate(filter)
  const all = (await Promise.all(dirs.map(readMemories))).flat()
  return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

const findFile = async (id) => {
  requireId(id, 'memory id')
  for (const dir of await locate()) {
    const file = path.join(dir, `${id}.json`)
    try {
      await fs.access(file)
      return file
    } catch {
      // keep looking
    }
  }
  throw httpError(404, `memory not found: ${id}`)
}

const writeFileAtomic = async (file, memory) => {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${memory.id}.${process.pid}.tmp`)
  await fs.writeFile(tmp, `${JSON.stringify(memory, null, 2)}\n`)
  await fs.rename(tmp, file)
}

const findMemory = async (id) => {
  const memory = await readMemoryFile(await findFile(id))
  if (!memory) throw httpError(404, `memory not found: ${id}`)
  return memory
}

const createMemory = async ({ title, content, evidence, sourceSessionId, memorySessionId } = {}) => {
  requireId(sourceSessionId, 'source session id')
  requireId(memorySessionId, 'memory session id')
  const id = genId()
  const memory = {
    id,
    title: requireText(title, 'title'),
    content: requireText(content, 'content'),
    evidence: optionalText(evidence, 'evidence'),
    sourceSessionId,
    memorySessionId,
    createdAt: Date.now(),
  }
  await writeFileAtomic(path.join(memoriesDir(sourceSessionId, memorySessionId), `${id}.json`), memory)
  return memory
}

const updateMemory = async (id, patch = {}) => {
  const file = await findFile(id)
  const memory = await readMemoryFile(file)
  if (!memory) throw httpError(404, `memory not found: ${id}`)
  const next = { ...memory }
  if (patch.title !== undefined) next.title = requireText(patch.title, 'title')
  if (patch.content !== undefined) next.content = requireText(patch.content, 'content')
  if (patch.evidence !== undefined) next.evidence = optionalText(patch.evidence, 'evidence')
  next.updatedAt = Date.now()
  await writeFileAtomic(file, next)
  return next
}

const deleteMemory = async (id) => {
  const file = await findFile(id)
  await fs.unlink(file)
}

module.exports = { isSegmentId, genId, listMemories, findMemory, createMemory, updateMemory, deleteMemory }
