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
  const events = []
  const offsets = []
  let consumed = 0
  let newline
  // Find boundaries in bytes so a partial UTF-8 character cannot move the cursor.
  while ((newline = buf.indexOf(10, consumed)) !== -1) {
    const line = buf.subarray(consumed, newline).toString('utf8')
    consumed = newline + 1
    if (!line) continue
    try {
      events.push(JSON.parse(line))
      offsets.push(offset + consumed)
    } catch {
      // skip malformed line
    }
  }
  return { events, offsets, offset: offset + consumed }
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

const readFromAsync = async (sessionId, offset = 0, writeDir, { maxBytes = Infinity, end = Infinity } = {}) => {
  let handle
  try {
    handle = await fs.promises.open(paths.eventsFile(sessionId, writeDir), 'r')
  } catch (err) {
    if (err.code === 'ENOENT') return { events: [], offset: 0 }
    throw err
  }
  try {
    const size = Math.min((await handle.stat()).size, end)
    if (offset >= size) return { events: [], offset }
    const chunks = []
    let bytes = 0
    // A single large event must remain intact, but ordinary replay reads are bounded.
    while (offset + bytes < size) {
      const buf = Buffer.alloc(Math.min(size - offset - bytes, Math.max(1, maxBytes)))
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset + bytes)
      if (!bytesRead) break
      const chunk = buf.subarray(0, bytesRead)
      chunks.push(chunk)
      bytes += bytesRead
      if (chunk.includes(10)) break
    }
    return parseChunk(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bytes), offset)
  } finally {
    await handle.close()
  }
}

module.exports = { append, readFrom, readFromAsync }
