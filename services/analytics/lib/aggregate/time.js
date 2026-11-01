// Time parsing and bucket keys for tool-call stats.

const BUCKETS = ['hour', 'day', 'week']
const UNITS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }

const parseTime = (value, now = Date.now()) => {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  const relative = /^(\d+(?:\.\d+)?)([mhdw])$/.exec(text)
  if (relative) return now - Number(relative[1]) * UNITS[relative[2]]
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00`).getTime()
    : Date.parse(text)
  if (Number.isNaN(ms)) throw new Error(`invalid time: ${value}`)
  return ms
}

const pad2 = (n) => String(n).padStart(2, '0')

const localDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const bucketKey = (ts, bucket) => {
  const date = new Date(ts)
  if (bucket === 'hour') return `${localDate(date)} ${pad2(date.getHours())}:00`
  if (bucket === 'week') {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7))
    return localDate(monday)
  }
  return localDate(date)
}

module.exports = { BUCKETS, parseTime, bucketKey }
