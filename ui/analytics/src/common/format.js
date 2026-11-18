export const number = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : 'Unknown'

export const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value)}` : 'Unknown'

export const shortId = value => value ? String(value).length > 24 ? `${String(value).slice(0, 12)}…${String(value).slice(-8)}` : String(value) : 'Unknown'

export const asText = value => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)

export const preview = (value, limit = 160) => {
  const text = asText(value).replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export const date = value => {
  if (value === null || value === undefined || value === '') return 'Unknown'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString()
}
