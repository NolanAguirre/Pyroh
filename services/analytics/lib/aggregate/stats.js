// Small counting helpers shared by the tool-call summaries.

const runKeyOf = (call) => `${call.sessionId}\0${call.runId || ''}`

const countBy = (items, keyOf) => {
  const counts = new Map()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

const sortedCounts = (counts, keyName) =>
  [...counts.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((a, b) => b.count - a.count || String(a[keyName]).localeCompare(String(b[keyName])))

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places

const percentile = (sorted, p) => {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

module.exports = { runKeyOf, countBy, sortedCounts, round, percentile }
