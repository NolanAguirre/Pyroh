const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

// Per-session port of the harness events.jsonl tool-call scan.

const TOOL_CALL_MARKER = '"type":"tool_call"'
const TARGET_MAX_LENGTH = 400
const PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'notebook_path', 'target_directory', 'targetDirectory']
const PATTERN_KEYS = ['pattern', 'globPattern', 'glob_pattern', 'regex', 'query']
const SCOPE_KEYS = ['path', 'targetDirectory', 'target_directory', 'directory', 'cwd']
const FILTER_KEYS = ['glob', 'include']

const forEachLine = async (file, onLine) => {
  let stream
  try {
    await fs.promises.access(file)
    stream = fs.createReadStream(file, { encoding: 'utf8' })
  } catch {
    return
  }
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of lines) onLine(line)
}

const subagentTypeOf = (input) => {
  if (!input || typeof input !== 'object') return null
  const value = input.subagentType ?? input.subagent_type
  if (!value) return null
  if (typeof value === 'string') return value
  return value.kind || value.name || value.type || null
}

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const clip = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > TARGET_MAX_LENGTH ? `${flat.slice(0, TARGET_MAX_LENGTH - 1)}…` : flat
}

const relPath = (value, cwd) => {
  if (!cwd || !path.isAbsolute(value)) return value
  const rel = path.relative(cwd, value)
  if (rel === '') return '.'
  return rel.startsWith('..') ? value : rel
}

const firstString = (input, keys) => {
  for (const key of keys) {
    if (typeof input[key] === 'string' && input[key]) return input[key]
  }
  return null
}

// Groupable target of a tool call: the file for read/edit/write, the
// pattern (+ filter, scope) for grep/glob, the command for shells, etc.
// Calls sharing a target are candidates for redundancy.
const targetOf = (input, cwd) => {
  if (input === null || input === undefined) return { kind: 'none', key: '(no input)' }
  if (typeof input !== 'object') return { kind: 'text', key: clip(input) }
  if (Array.isArray(input)) {
    const files = input.map((item) => item && typeof item.path === 'string' && relPath(item.path, cwd)).filter(Boolean)
    return files.length
      ? { kind: 'file', key: clip(files.join(', ')) }
      : { kind: 'input', key: clip(stableJson(input)) }
  }
  if (typeof input.command === 'string') {
    const dir = firstString(input, ['workingDirectory', 'working_directory', 'cwd'])
    const scope = dir && relPath(dir, cwd)
    return { kind: 'command', key: clip(scope && scope !== '.' ? `${input.command} @ ${scope}` : input.command) }
  }
  const pattern = firstString(input, PATTERN_KEYS)
  if (pattern) {
    const filter = firstString(input, FILTER_KEYS)
    const scope = firstString(input, SCOPE_KEYS)
    const parts = [pattern]
    if (filter) parts.push(`[${filter}]`)
    if (scope) parts.push(`in ${relPath(scope, cwd)}`)
    return { kind: 'pattern', key: clip(parts.join(' ')) }
  }
  if (Array.isArray(input.paths)) {
    return { kind: 'file', key: clip(input.paths.map((item) => relPath(String(item), cwd)).join(', ')) }
  }
  const file = firstString(input, PATH_KEYS)
  if (file) return { kind: 'file', key: relPath(file, cwd) }
  if (typeof input.url === 'string') return { kind: 'url', key: clip(input.url) }
  if (typeof input.toolName === 'string') {
    const name = [input.providerIdentifier, input.toolName].filter(Boolean).join('/')
    return { kind: 'mcp', key: clip(`${name} ${stableJson(input.args ?? null)}`) }
  }
  return { kind: 'input', key: clip(stableJson(input)) }
}

const signatureOf = (input) => crypto.createHash('sha1').update(stableJson(input ?? null)).digest('base64')

// Postgres text cannot hold NUL, so keys use a tab separator instead.
const callKeyOf = (event, nextAnonymous) => (event.itemId
  ? `${event.runId || ''}\t${event.itemId}`
  : `\tanon${nextAnonymous()}`)

const textOrNull = (value) => (value === null || value === undefined ? null : String(value))

const compute = async (session) => {
  if (!session.eventsPath) return { calls: [] }
  const byKey = new Map()
  let anonymous = 0
  const nextAnonymous = () => anonymous++
  await forEachLine(session.eventsPath, (line) => {
    if (!line.includes(TOOL_CALL_MARKER)) return
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type !== 'tool_call') return
    const key = callKeyOf(event, nextAnonymous)
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.name && event.name) existing.name = event.name
      if (!existing.subagentType) existing.subagentType = subagentTypeOf(event.input)
      if (existing.input == null && event.input != null) existing.input = event.input
      return
    }
    byKey.set(key, {
      key,
      ts: Number.isFinite(event.ts) ? event.ts : null,
      runId: event.runId || null,
      phase: textOrNull(event.phase),
      step: textOrNull(event.step),
      name: event.name || null,
      subagentType: subagentTypeOf(event.input),
      input: event.input ?? null,
    })
  })

  const calls = [...byKey.values()].map((call) => {
    const target = targetOf(call.input, session.cwd)
    return {
      key: call.key,
      ts: call.ts,
      runId: call.runId,
      phase: call.phase,
      step: call.step,
      name: call.name || '(unknown)',
      subagentType: textOrNull(call.subagentType),
      targetKind: target.kind,
      target: target.key,
      signature: signatureOf(call.input),
    }
  })
  return { calls }
}

// Postgres text rejects NUL, which can appear inside tool inputs.
const stripNul = (value) => (typeof value === 'string' ? value.replace(/\u0000/g, '') : value)

const column = (calls, pick) => calls.map((call) => stripNul(pick(call)))

const store = async (client, session, result) => {
  await client.query('DELETE FROM tool_calls WHERE session_id = $1', [session.id])
  const { calls } = result
  if (!calls.length) return
  await client.query(
    `INSERT INTO tool_calls (session_id, call_key, run_id, ts, name, subagent_type, phase, step, target_kind, target, signature)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::timestamptz[], $5::text[], $6::text[], $7::text[],
                              $8::text[], $9::text[], $10::text[], $11::text[])`,
    [
      session.id,
      column(calls, (call) => call.key),
      column(calls, (call) => call.runId),
      column(calls, (call) => (call.ts === null ? null : new Date(call.ts).toISOString())),
      column(calls, (call) => call.name),
      column(calls, (call) => call.subagentType),
      column(calls, (call) => call.phase),
      column(calls, (call) => call.step),
      column(calls, (call) => call.targetKind),
      column(calls, (call) => call.target),
      column(calls, (call) => call.signature),
    ],
  )
}

const summary = (result) => {
  const byTool = {}
  for (const call of result.calls) byTool[call.name] = (byTool[call.name] || 0) + 1
  return { calls: result.calls.length, byTool }
}

module.exports = {
  name: 'tool-calls',
  version: 1,
  compute,
  store,
  summary,
  targetOf,
  signatureOf,
  stableJson,
  subagentTypeOf,
}
