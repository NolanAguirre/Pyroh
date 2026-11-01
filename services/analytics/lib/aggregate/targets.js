const { runKeyOf } = require('./stats')

const TARGET_LIMIT = 200

// Calls grouped by target. repeats: calls that hit a target already hit in
// the same run. exactRepeats: calls whose full input already ran in the same
// run. variants: distinct full inputs seen for the target.
const summarizeTargets = (calls, tool) => {
  const groups = new Map()
  for (const call of calls) {
    if (!groups.has(call.target)) {
      groups.set(call.target, {
        key: call.target,
        kind: call.targetKind,
        count: 0,
        runs: new Set(),
        sessions: new Map(),
        signatures: new Set(),
        runSignatures: new Set(),
        lastTs: null,
      })
    }
    const entry = groups.get(call.target)
    const runKey = runKeyOf(call)
    const runSignature = `${runKey}\0${call.signature}`
    if (!entry.sessions.has(call.sessionId)) {
      entry.sessions.set(call.sessionId, {
        sessionId: call.sessionId,
        sessionName: call.sessionName,
        workspaceId: call.workspaceId,
        workspaceName: call.workspaceName,
        provider: call.provider,
        count: 0,
        runs: new Set(),
        signatures: new Set(),
        exactRepeats: 0,
        lastTs: null,
      })
    }
    const session = entry.sessions.get(call.sessionId)
    if (entry.runSignatures.has(runSignature)) session.exactRepeats += 1
    entry.count += 1
    entry.runs.add(runKey)
    entry.signatures.add(call.signature)
    entry.runSignatures.add(runSignature)
    if (!entry.lastTs || call.ts > entry.lastTs) entry.lastTs = call.ts
    session.count += 1
    session.runs.add(runKey)
    session.signatures.add(call.signature)
    if (!session.lastTs || call.ts > session.lastTs) session.lastTs = call.ts
  }
  const rows = [...groups.values()]
    .map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      count: entry.count,
      runs: entry.runs.size,
      sessions: entry.sessions.size,
      repeats: entry.count - entry.runs.size,
      exactRepeats: entry.count - entry.runSignatures.size,
      variants: entry.signatures.size,
      lastTs: entry.lastTs,
      sessionCalls: [...entry.sessions.values()]
        .map((session) => ({
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          workspaceId: session.workspaceId,
          workspaceName: session.workspaceName,
          provider: session.provider,
          count: session.count,
          runs: session.runs.size,
          repeats: session.count - session.runs.size,
          exactRepeats: session.exactRepeats,
          variants: session.signatures.size,
          lastTs: session.lastTs,
        }))
        .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs),
    }))
    .sort((a, b) => b.count - a.count || b.repeats - a.repeats || a.key.localeCompare(b.key))
  return {
    tool,
    distinct: rows.length,
    calls: calls.length,
    repeats: rows.reduce((sum, row) => sum + row.repeats, 0),
    exactRepeats: rows.reduce((sum, row) => sum + row.exactRepeats, 0),
    truncated: rows.length > TARGET_LIMIT,
    rows: rows.slice(0, TARGET_LIMIT),
  }
}

module.exports = { summarizeTargets }
