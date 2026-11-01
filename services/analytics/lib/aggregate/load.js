const db = require('../db')
const { toList, sessionClauses, whereSql } = require('../filters')

const num = (value) => (value === null || value === undefined ? null : Number(value))

const usageOf = (row) => (row.input === null || row.input === undefined ? null : {
  input: num(row.input),
  output: num(row.output),
  cacheRead: num(row.cache_read),
  cacheWrite: num(row.cache_write),
  reasoning: num(row.reasoning),
  total: num(row.total),
})

const tsClauses = (column, { since, until }, params) => {
  const clauses = []
  if (since != null) {
    params.push(since)
    clauses.push(`(${column} IS NULL OR ${column} >= to_timestamp($${params.length}::float8 / 1000))`)
  }
  if (until != null) {
    params.push(until)
    clauses.push(`(${column} IS NULL OR ${column} <= to_timestamp($${params.length}::float8 / 1000))`)
  }
  return clauses
}

const epochMs = (column) => `round(extract(epoch FROM ${column}) * 1000)::float8`

// Calls in the in-memory shape summarize expects, oldest first.
const loadCalls = async (options) => {
  const params = []
  const clauses = [...sessionClauses(options, params), ...tsClauses('c.ts', options, params)]
  const tools = toList(options.tool)
  if (tools) {
    params.push(tools)
    clauses.push(`c.name = ANY($${params.length}::text[])`)
  }
  const { rows } = await db.query(
    `SELECT c.session_id, c.run_id, ${epochMs('c.ts')} AS ts, c.name, c.subagent_type, c.phase, c.step,
            c.target_kind, c.target, c.signature,
            s.name AS session_name, s.workspace_id, w.name AS workspace_name, s.provider, s.model,
            r.mode, r.input, r.output, r.cache_read, r.cache_write, r.reasoning, r.total
     FROM tool_calls c
     JOIN sessions s ON s.id = c.session_id
     LEFT JOIN workspaces w ON w.id = s.workspace_id
     LEFT JOIN runs r ON r.session_id = c.session_id AND r.run_id = c.run_id
     ${whereSql(clauses)}
     ORDER BY c.ts NULLS FIRST, c.session_id, c.call_key`,
    params,
  )
  return rows.map((row) => ({
    ts: row.ts,
    runId: row.run_id,
    sessionId: row.session_id,
    sessionName: row.session_name,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    provider: row.provider,
    model: row.model,
    phase: row.phase,
    step: row.step,
    mode: row.mode,
    name: row.name,
    subagentType: row.subagent_type,
    usage: usageOf(row),
    targetKind: row.target_kind,
    target: row.target,
    signature: row.signature,
  }))
}

// Every run with recorded usage, including runs that made no tool calls.
const loadRuns = async (options) => {
  const params = []
  const clauses = [
    ...sessionClauses(options, params),
    ...tsClauses('r.started_at', options, params),
    'r.input IS NOT NULL',
  ]
  const { rows } = await db.query(
    `SELECT r.session_id, r.run_id, ${epochMs('r.started_at')} AS started_at, r.step, r.mode,
            r.input, r.output, r.cache_read, r.cache_write, r.reasoning, r.total,
            s.workspace_id, w.name AS workspace_name, s.provider
     FROM runs r
     JOIN sessions s ON s.id = r.session_id
     LEFT JOIN workspaces w ON w.id = s.workspace_id
     ${whereSql(clauses)}
     ORDER BY s.updated_at DESC NULLS LAST, r.session_id, r.started_at NULLS FIRST, r.run_id`,
    params,
  )
  return rows.map((row) => ({
    runId: row.run_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    provider: row.provider,
    step: row.step,
    mode: row.mode,
    firstTs: row.started_at,
    usage: usageOf(row),
  }))
}

module.exports = { loadCalls, loadRuns }
