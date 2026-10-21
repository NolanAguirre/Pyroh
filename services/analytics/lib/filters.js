const toList = (value) => {
  if (!value || value === true) return null
  const list = (Array.isArray(value) ? value.join(',') : String(value))
    .split(',').map((item) => item.trim()).filter(Boolean)
  return list.length ? list : null
}

const invalid = (message) => Object.assign(new Error(message), { httpStatus: 400 })

const parseBool = (value, name) => {
  if (value === undefined || value === null || value === '') return null
  if (['true', '1', 'yes'].includes(String(value))) return true
  if (['false', '0', 'no'].includes(String(value))) return false
  throw invalid(`${name} must be true or false`)
}

const parseCount = (value, name, fallback, max = Infinity) => {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw invalid(`${name} must be a non-negative integer`)
  return Math.min(n, max)
}

// WHERE clauses over sessions s LEFT JOIN workspaces w. Like the harness
// session scan, a session is in range when updated at/after since and created
// at/before until; missing timestamps always match. since/until are epoch ms.
const sessionClauses = ({ workspace, session, provider, since, until, archived } = {}, params) => {
  const clauses = []
  const bind = (value) => {
    params.push(value)
    return `$${params.length}`
  }
  const workspaces = toList(workspace)
  if (workspaces) {
    const p = bind(workspaces)
    clauses.push(`(s.workspace_id = ANY(${p}::text[]) OR w.name = ANY(${p}::text[]))`)
  }
  const sessions = toList(session)
  if (sessions) clauses.push(`s.id = ANY(${bind(sessions)}::text[])`)
  const providers = toList(provider)
  if (providers) clauses.push(`s.provider = ANY(${bind(providers)}::text[])`)
  if (since != null) clauses.push(`(s.updated_at IS NULL OR s.updated_at >= to_timestamp(${bind(since)}::float8 / 1000))`)
  if (until != null) clauses.push(`(s.created_at IS NULL OR s.created_at <= to_timestamp(${bind(until)}::float8 / 1000))`)
  if (archived != null) clauses.push(`s.archived = ${bind(archived)}::boolean`)
  return clauses
}

const whereSql = (clauses) => (clauses.length ? `WHERE ${clauses.join(' AND ')}` : '')

module.exports = { toList, invalid, parseBool, parseCount, sessionClauses, whereSql }
