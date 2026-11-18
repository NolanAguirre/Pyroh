const fs = require('fs')

const requestUsage = usage => Object.fromEntries(Object.entries({
  inputTokens: ['inputTokens', 'input_tokens'], outputTokens: ['outputTokens', 'output_tokens'],
  cacheReadTokens: ['cachedInputTokens', 'cached_input_tokens'],
  cacheWriteTokens: ['cacheWriteInputTokens', 'cache_write_input_tokens'],
  reasoningTokens: ['reasoningOutputTokens', 'reasoning_output_tokens'],
  totalTokens: ['totalTokens', 'total_tokens'],
}).map(([key, names]) => [key, names.map(name => usage?.[name])
  .find(value => Number.isSafeInteger(value) && value >= 0) ?? null]))

// Read only a provider-supplied file. Bound both work per drain and retained
// partial lines, including large prompt/tool records which are never exported.
const createReader = (file, { fromEnd = false, maxBytes = 1024 * 1024, maxLineBytes = 256 * 1024 } = {}) => {
  let offset = 0
  let identity = null
  let partial = Buffer.alloc(0)
  let skipping = false
  let issue = null
  if (fromEnd) {
    try {
      const stat = fs.statSync(file)
      offset = stat.size
      identity = `${stat.dev}:${stat.ino}`
    } catch (err) { issue = err.code || 'unavailable' }
  }
  const read = () => {
    let fd
    const records = []
    let remaining = null
    let skipped = 0
    try {
      fd = fs.openSync(file, 'r')
      const stat = fs.fstatSync(fd)
      if (!stat.isFile()) return { records, remaining, skipped, issue: 'not_a_file' }
      const nextIdentity = `${stat.dev}:${stat.ino}`
      if ((identity && identity !== nextIdentity) || stat.size < offset) {
        offset = 0
        partial = Buffer.alloc(0)
        skipping = false
      }
      identity = nextIdentity
      const bytes = Buffer.alloc(Math.min(maxBytes, Math.max(0, stat.size - offset)))
      const length = fs.readSync(fd, bytes, 0, bytes.length, offset)
      offset += length
      remaining = Math.max(0, stat.size - offset)
      const buffer = Buffer.concat([partial, bytes.subarray(0, length)])
      let start = 0
      let end
      while ((end = buffer.indexOf(10, start)) !== -1) {
        if (!skipping && end - start <= maxLineBytes) {
          try { records.push(JSON.parse(buffer.subarray(start, end).toString('utf8'))) }
          catch { skipped += 1 }
        } else skipped += 1
        skipping = false
        start = end + 1
      }
      partial = Buffer.from(buffer.subarray(start))
      if (skipping || partial.length > maxLineBytes) {
        partial = Buffer.alloc(0)
        skipping = true
      }
      issue = null
    } catch (err) { issue = err.code || 'unavailable' }
    finally { if (fd !== undefined) fs.closeSync(fd) }
    return { records, remaining, skipped, issue }
  }
  return { read }
}

module.exports = { createReader, requestUsage }
