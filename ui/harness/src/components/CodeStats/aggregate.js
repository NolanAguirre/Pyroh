export const LENGTH_BUCKETS = [
  { id: 'b50', label: '≤50', min: 0, max: 50 },
  { id: 'b100', label: '51–100', min: 51, max: 100 },
  { id: 'b200', label: '101–200', min: 101, max: 200 },
  { id: 'b300', label: '201–300', min: 201, max: 300 },
  { id: 'b500', label: '301–500', min: 301, max: 500 },
  { id: 'b1000', label: '501–1k', min: 501, max: 1000 },
  { id: 'bmax', label: '1k+', min: 1001, max: Infinity },
]

const round = (value) => Math.round(value * 10) / 10

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const byLinesDesc = (a, b) => b.lines - a.lines || byId(a, b)

const median = (sorted) => {
  const n = sorted.length
  if (!n) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2)
}

const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : 0)

export const summarize = (files) => {
  const sorted = files.map((file) => file.lines).sort((a, b) => a - b)
  const lines = sorted.reduce((sum, n) => sum + n, 0)
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const largest = files.reduce((best, file) => (!best || file.lines > best.lines || (file.lines === best.lines && file.path < best.path) ? file : best), null)
  return {
    files: files.length,
    lines,
    bytes,
    mean: files.length ? round(lines / files.length) : 0,
    median: median(sorted),
    p90: percentile(sorted, 0.9),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    largest: largest ? largest.path : null,
  }
}

const groupBy = (files, keysOf) => {
  const groups = new Map()
  files.forEach((file) => {
    keysOf(file).forEach((key) => {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(file)
    })
  })
  return groups
}

export const byLanguage = (files, names = {}) =>
  [...groupBy(files, (file) => [file.language])]
    .map(([id, group]) => ({ id, name: names[id] || id, ...summarize(group) }))
    .sort(byLinesDesc)

const ancestors = (filePath) => {
  const segments = filePath.split('/').slice(0, -1)
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

export const byDirectory = (files) =>
  [...groupBy(files, (file) => ancestors(file.path))]
    .map(([id, group]) => ({ id, path: id, depth: id.split('/').length, ...summarize(group) }))
    .sort(byLinesDesc)

export const lengthDistribution = (files) =>
  LENGTH_BUCKETS.map((bucket) => ({
    ...bucket,
    count: files.filter((file) => file.lines >= bucket.min && file.lines <= bucket.max).length,
  }))

export const inBucket = (bucketId) => {
  const bucket = LENGTH_BUCKETS.find((item) => item.id === bucketId)
  return bucket ? (file) => file.lines >= bucket.min && file.lines <= bucket.max : () => true
}

export const inScope = (scope) => (scope ? (file) => file.path.startsWith(`${scope}/`) : () => true)

export const sortFiles = (files) => [...files].sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
