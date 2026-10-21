const config = require('../config')

const NOTIFY_TIMEOUT_MS = 5000
const REQUEST_TIMEOUT_MS = 60000
const QUERY_KEYS = ['since', 'until', 'bucket', 'by', 'top', 'workspace', 'wid', 'session', 'provider', 'tool']

const errorText = (err) => (err && err.message ? err.message : String(err))

const httpError = (message, httpStatus) => Object.assign(new Error(message), { httpStatus })

// Fire-and-forget: analytics is derived data, so failures are logged and never
// propagate into the run that triggered them. The returned promise always
// resolves, letting a daemon about to exit wait for the request to settle.
const notifySession = (sessionId) => {
  if (!config.analyticsUrl || !sessionId) return Promise.resolve()
  try {
    return fetch(`${config.analyticsUrl}/sessions/${encodeURIComponent(sessionId)}/notify`, {
      method: 'POST',
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) console.error(`analytics: notify for ${sessionId} rejected with ${res.status}`)
      })
      .catch((err) => {
        console.error(`analytics: notify for ${sessionId} failed: ${errorText(err)}`)
      })
  } catch (err) {
    console.error(`analytics: notify for ${sessionId} failed: ${errorText(err)}`)
    return Promise.resolve()
  }
}

// 4xx responses keep their status (bad query params); anything else is a 502.
const request = async (method, pathname, { query, body } = {}) => {
  if (!config.analyticsUrl) throw httpError('analytics service is not configured (HARNESS_ANALYTICS_URL)', 503)
  const search = query ? `?${new URLSearchParams(query)}` : ''
  let res
  try {
    res = await fetch(`${config.analyticsUrl}${pathname}${search}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw httpError(`analytics service unreachable: ${errorText(err)}`, 502)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const message = (payload && payload.error) || `analytics service responded ${res.status}`
    throw httpError(message, res.status >= 400 && res.status < 500 ? res.status : 502)
  }
  return payload
}

const toQuery = (raw = {}) => {
  const query = {}
  for (const key of QUERY_KEYS) {
    const value = raw[key]
    if (value === undefined || value === null || value === true || value === false) continue
    query[key] = Array.isArray(value) ? value.join(',') : String(value)
  }
  return query
}

// Same params as `harness tool-stats`; resolves to the summarize() stats.
const toolStats = async (raw) => (await request('GET', '/aggregate/tool-calls', { query: toQuery(raw) })).stats

// { sessionId?, compute? } → { sessions, job }
const sync = (body = {}) => request('POST', '/sync', { body })

module.exports = { notifySession, toolStats, sync }
