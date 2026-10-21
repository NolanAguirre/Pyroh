const fs = require('fs')
const path = require('path')
const paths = require('./paths')
const { ensureDir } = require('./jsonFile')

// Append a normalized event as one JSON line to the session's events.jsonl.
const append = (sessionId, event, writeDir) => {
  const file = paths.eventsFile(sessionId, writeDir)
  ensureDir(path.dirname(file))
  const record = { ts: Date.now(), ...event }
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
  return record
}

const parseChunk = (buf, offset) => {
  const text = buf.toString('utf8')
  const lines = text.split('\n')
  // The last element is either '' (clean end) or a partial line.
  const trailing = lines.pop()
  const consumed = buf.length - Buffer.byteLength(trailing, 'utf8')
  const events = []
  for (const line of lines) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // skip malformed line
    }
  }
  return { events, offset: offset + consumed }
}

// Read events starting from a byte offset. Returns parsed events, the new byte
// offset, and any trailing partial line preserved for the next read.
const readFrom = (sessionId, offset = 0, writeDir) => {
  const file = paths.eventsFile(sessionId, writeDir)
  let stat
  try {
    stat = fs.statSync(file)
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], offset: 0 }
    throw err
  }
  if (offset >= stat.size) return { events: [], offset }

  const fd = fs.openSync(file, 'r')
  try {
    const length = stat.size - offset
    const buf = Buffer.alloc(length)
    fs.readSync(fd, buf, 0, length, offset)
    return parseChunk(buf, offset)
  } finally {
    fs.closeSync(fd)
  }
}

const readFromAsync = async (sessionId, offset = 0, writeDir) => {
  let handle
  try {
    handle = await fs.promises.open(paths.eventsFile(sessionId, writeDir), 'r')
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], offset: 0 }
    throw err
  }
  try {
    const { size } = await handle.stat()
    if (offset >= size) return { events: [], offset }
    const buf = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(buf, 0, buf.length, offset)
    return parseChunk(buf.subarray(0, bytesRead), offset)
  } finally {
    await handle.close()
  }
}

module.exports = { append, readFrom, readFromAsync }
