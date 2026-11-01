import { vsDetail } from './format'

export const tokenUsage = (tokens) => {
  const reads = tokens?.reads
  const writes = tokens?.writes
  const readTotal = (reads?.cache || 0) + (reads?.fresh || 0)
  const writeTotal = (writes?.cache || 0) + (writes?.fresh || 0)
  return { total: readTotal + writeTotal, readTotal, writeTotal, reads, writes }
}

export const perRunAverage = (value, runs) => (runs ? value / runs : null)

const shareSub = (pair, side, kind) => {
  if (!pair || !(pair.cache || pair.fresh)) return null
  const pct = side === 'cache' ? pair.cachePct : pair.freshPct
  return `${pct}% of ${kind}`
}

export const tokenMetrics = (tokens) => {
  const usage = tokenUsage(tokens)
  const runs = tokens?.runs || 0
  const metric = (id, label, total, note) => ({
    id,
    label,
    total,
    avg: perRunAverage(total, runs),
    note,
  })
  return {
    runs,
    usage,
    rows: [
      metric('total', 'Total', usage.total, null),
      metric('reads', 'Reads', usage.readTotal, vsDetail(usage.reads)),
      metric('writes', 'Writes', usage.writeTotal, vsDetail(usage.writes)),
      metric('cache-reads', 'Cache reads', usage.reads?.cache || 0, shareSub(usage.reads, 'cache', 'reads')),
      metric('new-reads', 'New reads', usage.reads?.fresh || 0, shareSub(usage.reads, 'fresh', 'reads')),
      metric('cache-writes', 'Cache writes', usage.writes?.cache || 0, shareSub(usage.writes, 'cache', 'writes')),
      metric('new-writes', 'New writes', usage.writes?.fresh || 0, shareSub(usage.writes, 'fresh', 'writes')),
    ],
  }
}
