const { round } = require('./stats')

const pairShare = (cache, fresh) => {
  const total = cache + fresh
  const cachePct = total ? round((cache / total) * 100, 1) : 0
  return {
    cache,
    fresh,
    cachePct,
    freshPct: total ? round(100 - cachePct, 1) : 0,
  }
}

// Stored input already includes cache reads and cache writes when they fit
// inside it. New reads are that remainder. New writes are output tokens.
const splitUsage = (usage) => {
  if (!usage) return null
  const input = usage.input || 0
  const output = usage.output || 0
  const cacheRead = usage.cacheRead || 0
  const cacheWrite = usage.cacheWrite || 0
  const cacheInside = cacheRead + cacheWrite <= input
  const newRead = cacheInside ? input - cacheRead - cacheWrite : input
  return {
    input,
    output,
    reads: pairShare(cacheRead, newRead),
    writes: pairShare(cacheWrite, output),
    inputPerOutput: output ? round(input / output, 2) : null,
  }
}

const sumUsage = (parts) => {
  const known = parts.filter(Boolean)
  const input = known.reduce((sum, part) => sum + part.input, 0)
  const output = known.reduce((sum, part) => sum + part.output, 0)
  const cacheRead = known.reduce((sum, part) => sum + part.reads.cache, 0)
  const newRead = known.reduce((sum, part) => sum + part.reads.fresh, 0)
  const cacheWrite = known.reduce((sum, part) => sum + part.writes.cache, 0)
  const newWrite = known.reduce((sum, part) => sum + part.writes.fresh, 0)
  return {
    runs: known.length,
    input,
    output,
    reads: pairShare(cacheRead, newRead),
    writes: pairShare(cacheWrite, newWrite),
    inputPerOutput: output ? round(input / output, 2) : null,
  }
}

const usageTotal = (tokens) =>
  tokens.reads.cache + tokens.reads.fresh + tokens.writes.cache + tokens.writes.fresh

module.exports = { splitUsage, sumUsage, usageTotal }
