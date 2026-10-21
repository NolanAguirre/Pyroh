const fs = require('fs')
const path = require('path')

const QUEUE_DIR = process.env.QUEUE_DIR

const QUEUE_STATES = ['tmp', 'pending', 'processing', 'done', 'failed']
const JOB_STATES = ['pending', 'processing', 'done', 'failed']
const NEWEST_FIRST_STATES = ['done', 'failed']
const DEFAULT_STATUS_LIMIT = 25
const MAX_STATUS_LIMIT = 200

// task and key become part of a filename, so keep them to a safe alphabet.
const SAFE_PART = /^[A-Za-z0-9._-]{1,128}$/
const JOB_ID = /^[A-Za-z0-9._-]{1,128}__[A-Za-z0-9._-]{1,128}$/

const requireQueueDir = () => {
  if (!QUEUE_DIR) throw new Error('QUEUE_DIR is not set')
  return QUEUE_DIR
}

const isSafePart = (value) => typeof value === 'string' && SAFE_PART.test(value)

const isJobId = (value) => typeof value === 'string' && JOB_ID.test(value)

const jobId = (task, key) => `${task}__${key}`

// Filenames are <task>__<key>.json so re-sending the same job overwrites the
// pending descriptor instead of piling up duplicates. Writing to tmp/ then
// renaming into pending/ makes the descriptor appear atomically, so the
// consumer never claims a half-written file.
const enqueueJob = async ({ task, key, input, callback }) => {
  const queueDir = requireQueueDir()
  const tmpDir = path.join(queueDir, 'tmp')
  const pendingDir = path.join(queueDir, 'pending')

  await fs.promises.mkdir(tmpDir, { recursive: true })
  await fs.promises.mkdir(pendingDir, { recursive: true })

  const id = jobId(task, key)
  const name = `${id}.json`
  const tmpPath = path.join(tmpDir, `${name}.tmp`)
  const pendingPath = path.join(pendingDir, name)

  const descriptor = {
    id,
    task,
    key,
    input,
    callback: callback || null,
    enqueued_at: new Date().toISOString(),
  }

  await fs.promises.writeFile(tmpPath, JSON.stringify(descriptor))
  await fs.promises.rename(tmpPath, pendingPath)
  return descriptor
}

// Look the job up in each state in lifecycle order. A job can be renamed
// between states mid-lookup, so a miss in one state just moves to the next.
const readJob = async (id) => {
  const queueDir = requireQueueDir()
  const name = `${id}.json`

  for (const state of JOB_STATES) {
    const file = path.join(queueDir, state, name)
    try {
      const [raw, stats] = await Promise.all([
        fs.promises.readFile(file, 'utf8'),
        fs.promises.stat(file),
      ])
      return { ...JSON.parse(raw), state, updated_at: new Date(stats.mtimeMs).toISOString() }
    } catch (error) {
      if (error.code === 'ENOENT') continue
      if (error instanceof SyntaxError) return { id, state, corrupt: true }
      throw error
    }
  }
  return null
}

const parseStatusLimit = (value) => {
  const limit = parseInt(value, 10)
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_STATUS_LIMIT
  return Math.min(limit, MAX_STATUS_LIMIT)
}

// Descriptors are <name>.json everywhere except tmp/, where a half-written one
// is <name>.json.tmp until the rename lands.
const isDescriptor = (name) => name.endsWith('.json') || name.endsWith('.json.tmp')

// Missing directories mean an empty state, and entries can vanish mid-read
// when the consumer renames them along; neither is an error for a snapshot.
const listDescriptors = async (dir) => {
  let names = []
  try {
    names = await fs.promises.readdir(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }

  const entries = []
  for (const name of names) {
    if (!isDescriptor(name)) continue
    try {
      const stats = await fs.promises.stat(path.join(dir, name))
      entries.push({ name, mtime: stats.mtimeMs })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return entries
}

const readDescriptor = async (dir, entry) => {
  const updatedAt = new Date(entry.mtime).toISOString()
  try {
    const raw = await fs.promises.readFile(path.join(dir, entry.name), 'utf8')
    return { ...JSON.parse(raw), name: entry.name, updated_at: updatedAt }
  } catch {
    return { name: entry.name, updated_at: updatedAt, corrupt: true }
  }
}

// pending/processing are oldest first to match the consumer's claim order;
// done/failed are newest first because recent outcomes matter most.
const readQueueStatus = async (requestedLimit) => {
  const queueDir = requireQueueDir()
  const limit = parseStatusLimit(requestedLimit)
  const counts = {}
  const jobs = {}

  for (const state of QUEUE_STATES) {
    const dir = path.join(queueDir, state)
    const entries = await listDescriptors(dir)
    counts[state] = entries.length

    if (!JOB_STATES.includes(state)) continue

    entries.sort(NEWEST_FIRST_STATES.includes(state)
      ? (a, b) => b.mtime - a.mtime
      : (a, b) => a.mtime - b.mtime)

    jobs[state] = []
    for (const entry of entries.slice(0, limit)) {
      jobs[state].push(await readDescriptor(dir, entry))
    }
  }

  return { queue_dir: queueDir, limit, counts, jobs }
}

module.exports = {
  isSafePart,
  isJobId,
  enqueueJob,
  readJob,
  readQueueStatus,
}
