const { sumUsage, usageTotal } = require('./usage')

const summarizeWorkspaces = (runList) => {
  const groups = new Map()
  for (const run of runList) {
    const key = run.workspaceId || ''
    if (!groups.has(key)) {
      groups.set(key, {
        workspaceId: run.workspaceId || null,
        workspaceName: run.workspaceName || null,
        sessions: new Set(),
        runs: [],
      })
    }
    const entry = groups.get(key)
    entry.sessions.add(run.sessionId)
    entry.runs.push(run)
  }
  return [...groups.values()]
    .map((entry) => {
      const tokens = sumUsage(entry.runs.map((run) => run.tokens))
      return {
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        sessions: entry.sessions.size,
        runs: entry.runs.length,
        calls: entry.runs.reduce((sum, run) => sum + run.count, 0),
        tokens: { ...tokens, total: usageTotal(tokens) },
      }
    })
    .sort((a, b) => b.tokens.total - a.tokens.total || b.runs - a.runs)
}

module.exports = { summarizeWorkspaces }
