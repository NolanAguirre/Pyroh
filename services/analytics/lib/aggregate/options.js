const { invalid } = require('../filters')
const { BUCKETS, parseTime } = require('./time')

const GROUPS = ['workspace', 'provider', 'model', 'session']

const parseOptions = (raw = {}, now = Date.now()) => {
  let since
  let until
  try {
    since = parseTime(raw.since, now)
    until = parseTime(raw.until, now)
  } catch (err) {
    throw invalid(err.message)
  }
  const bucket = raw.bucket || 'day'
  if (!BUCKETS.includes(bucket)) throw invalid(`bucket must be one of ${BUCKETS.join('|')}`)
  const by = raw.by || null
  if (by && !GROUPS.includes(by)) throw invalid(`by must be one of ${GROUPS.join('|')}`)
  const top = raw.top === undefined || raw.top === '' ? 10 : Number(raw.top)
  if (!Number.isInteger(top) || top < 1) throw invalid('top must be a positive integer')
  return {
    since,
    until,
    bucket,
    by,
    top,
    workspace: raw.workspace || raw.wid,
    session: raw.session,
    provider: raw.provider,
    tool: raw.tool,
  }
}

module.exports = { GROUPS, parseOptions }
