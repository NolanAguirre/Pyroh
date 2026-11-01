const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const QUEUE_DIR = process.env.QUEUE_DIR
const POLL_MS = 50

const requireQueueDir = () => {
  if (!QUEUE_DIR) throw new Error('QUEUE_DIR is not set')
  return QUEUE_DIR
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readIfExists = async (file) => {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

const removeIfExists = (file) => fs.promises.unlink(file).catch(() => {})

// Writes a pick job and waits for the consumer to move it into done/ or
// failed/. Returns the consumer's result, or null on failure or timeout. A
// job that is still pending at the timeout is withdrawn; one already being
// processed is left to finish and its done/ file is removed by sweepDone.
const runJob = async (words, timeoutMs) => {
  const queueDir = requireQueueDir()
  const name = `${Date.now()}-${crypto.randomUUID()}.json`
  const tmpPath = path.join(queueDir, 'tmp', `${name}.tmp`)
  const pendingPath = path.join(queueDir, 'pending', name)
  const donePath = path.join(queueDir, 'done', name)
  const failedPath = path.join(queueDir, 'failed', name)

  await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true })
  await fs.promises.mkdir(path.dirname(pendingPath), { recursive: true })
  await fs.promises.writeFile(tmpPath, JSON.stringify({ words, enqueued_at: new Date().toISOString() }))
  await fs.promises.rename(tmpPath, pendingPath)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const raw = await readIfExists(donePath)
    if (raw !== null) {
      await removeIfExists(donePath)
      try {
        return JSON.parse(raw).result || null
      } catch {
        return null
      }
    }
    if (await readIfExists(failedPath) !== null) {
      await removeIfExists(failedPath)
      return null
    }
    await sleep(POLL_MS)
  }
  await removeIfExists(pendingPath)
  return null
}

// Results nobody waited for pile up in done/ after timeouts.
const sweepDone = async (maxAgeMs) => {
  const doneDir = path.join(requireQueueDir(), 'done')
  let names = []
  try {
    names = await fs.promises.readdir(doneDir)
  } catch {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  for (const name of names) {
    const file = path.join(doneDir, name)
    try {
      if ((await fs.promises.stat(file)).mtimeMs < cutoff) await removeIfExists(file)
    } catch {
      // Gone already.
    }
  }
}

module.exports = { runJob, sweepDone }
