const express = require('express')
const config = require('./lib/config')
const db = require('./lib/db')
const { createLifecycle } = require('./lib/runLifecycle')
const { createJobQueue } = require('./lib/jobs')
const healthRouter = require('./routes/health')
const createSyncRouter = require('./routes/sync')
const { createSessionsRouter } = require('./routes/sessions')
const createMetricsRouter = require('./routes/metrics')
const createComputeRouter = require('./routes/compute')
const jobsRouter = require('./routes/jobs')
const resultsRouter = require('./routes/results')
const aggregateRouter = require('./routes/aggregate')
const analyzeSubagentRouter = require('./routes/analyzeSubagent')
const subagentReplayRouter = require('./routes/subagentReplay')
const subagentSessionsRouter = require('./routes/subagentSessions')

const queue = createJobQueue({ concurrency: config.computeConcurrency })
const lifecycle = createLifecycle({ queue })

const app = express()

app.use(express.json({ limit: '1mb' }))
app.use('/health', healthRouter)
app.use('/sync', createSyncRouter({ queue }))
app.use('/sessions', createSessionsRouter({ queue }))
app.use('/sessions', analyzeSubagentRouter)
app.use('/sessions', subagentReplayRouter)
app.use('/subagent-sessions', subagentSessionsRouter)
app.use('/metrics', createMetricsRouter({ queue }))
app.use('/compute', createComputeRouter({ queue }))
app.use('/jobs', jobsRouter)
app.use('/results', resultsRouter)
app.use('/aggregate', aggregateRouter)

app.use((err, _req, res, _next) => {
  const status = err.httpStatus || err.status || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err && err.message ? err.message : String(err) })
})

// Requeue pairs a previous process left mid-compute, then catch up on
// everything that changed while the service was down.
const startup = async () => {
  await queue.recover()
  if (!stopping) lifecycle.start()
}

const server = app.listen(config.port, config.host, () => {
  console.log(`analytics running at http://${config.host}:${config.port} (sessions from ${config.harnessWriteDir})`)
  startup().catch((err) => console.error(`analytics: startup sync failed: ${err && err.message ? err.message : err}`))
})

let stopping = false
const shutdown = (signal) => {
  if (stopping) {
    process.exit(1)
    return
  }
  stopping = true
  console.log(`Received ${signal}, shutting down`)
  server.close(() => lifecycle.stop().finally(() => db.close().finally(() => process.exit(0))))
  server.closeAllConnections()
  setTimeout(() => process.exit(1), 8000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
