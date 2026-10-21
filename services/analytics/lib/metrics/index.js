const runUsage = require('./runUsage')
const toolCalls = require('./toolCalls')

// Each metric: { name, version, compute(session) → result, store?(client, session, result),
// summary?(result) }. store rewrites the session's fact rows in the same
// transaction as the metric_results upsert; summary picks what is cached as
// metric_results.result (defaults to the whole result). Raise version to have
// stale results recomputed, then POST /metrics/:name/backfill.
const METRICS = [runUsage, toolCalls]

const byName = new Map(METRICS.map((metric) => [metric.name, metric]))

const list = () => METRICS

const get = (name) => byName.get(name) || null

module.exports = { list, get }
