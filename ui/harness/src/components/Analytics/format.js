import { formatNumber } from '../../format'

export const formatTs = (ts) => (ts ? new Date(ts).toLocaleString() : '—')

export const bucketLabel = (key, bucket) => (bucket === 'week' ? `wk ${key.slice(5)}` : key.slice(5))

export const vsText = (pair) => (pair && (pair.cache || pair.fresh) ? `${pair.cachePct}% vs ${pair.freshPct}%` : '—')

export const vsDetail = (pair) => (pair && (pair.cache || pair.fresh)
  ? `${formatNumber(pair.cache)} cache · ${formatNumber(pair.fresh)} new`
  : null)

export const ioText = (tokens) => (tokens && tokens.inputPerOutput != null ? `${tokens.inputPerOutput} : 1` : '—')

export const ioDetail = (tokens) => (tokens && (tokens.input || tokens.output)
  ? `${formatNumber(tokens.input)} in · ${formatNumber(tokens.output)} out`
  : null)

export const formatAverage = (value) => (value == null ? '—' : formatNumber(value))
