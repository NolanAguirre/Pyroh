const integerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

export const formatNumber = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return integerFormatter.format(0)
  return integerFormatter.format(n)
}

export const formatDuration = (ms) => {
  if (!ms || ms < 0) return '0s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  return `${minutes}m ${remSec}s`
}

export const formatCompactNumber = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

