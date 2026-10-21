const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'EHOSTDOWN', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED',
])

const NETWORK_PATTERN = new RegExp([
  'fetch failed', 'socket hang up', 'other side closed', 'getaddrinfo', 'name resolution',
  'could not resolve host', 'unable to connect', 'error sending request', 'stream disconnected',
  'network (error|is unreachable|request failed|connection)', 'connection (error|reset|refused|closed|lost|timed out)',
  'websocket.*(closed|error)', ...NETWORK_CODES,
].join('|'), 'i')

const chain = (err, seen = new Set()) => {
  if (err == null || seen.has(err)) return []
  seen.add(err)
  if (typeof err !== 'object') return [err]
  const nested = [err.cause, err.error, ...(Array.isArray(err.errors) ? err.errors : [])]
  return [err, ...nested.flatMap((item) => chain(item, seen))]
}

// Walks cause/error/errors so wrapped SDK errors still classify as network loss.
const isNetworkError = (err) => chain(err).some((item) => {
  if (typeof item === 'string') return NETWORK_PATTERN.test(item)
  if (typeof item !== 'object') return false
  if (NETWORK_CODES.has(item.code) || NETWORK_CODES.has(item.errno)) return true
  return typeof item.message === 'string' && NETWORK_PATTERN.test(item.message)
})

const failureStatus = (err) => isNetworkError(err) ? 'disconnected' : 'error'

module.exports = { isNetworkError, failureStatus }
