const { BUCKETS, parseTime, bucketKey } = require('./time')
const { runKeyOf } = require('./stats')
const { splitUsage, sumUsage } = require('./usage')
const { summarizeWorkspaces } = require('./workspaces')
const { summarizeTargets } = require('./targets')
const { summarize } = require('./summarize')
const { GROUPS, parseOptions } = require('./options')
const { loadCalls, loadRuns } = require('./load')

// Tool-call stats over the tool_calls and runs fact tables. The output of
// summarize matches what the harness computed from events.jsonl directly.

const toolStats = async (options) => {
  const [calls, allUsageRuns] = await Promise.all([loadCalls(options), loadRuns(options)])
  const called = options.tool ? new Set(calls.map(runKeyOf)) : null
  const usageRuns = called ? allUsageRuns.filter((run) => called.has(runKeyOf(run))) : allUsageRuns
  return summarize(calls, { ...options, usageRuns })
}

module.exports = {
  BUCKETS,
  GROUPS,
  parseTime,
  parseOptions,
  summarize,
  summarizeTargets,
  summarizeWorkspaces,
  splitUsage,
  sumUsage,
  bucketKey,
  toolStats,
}
