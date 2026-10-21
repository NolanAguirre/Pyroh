const express = require('express')
const healthRouter = require('./routes/health')
const jobsRouter = require('./routes/jobs')
const queueRouter = require('./routes/queue')

const PORT = Number(process.env.PORT || 6002)
const HOST = process.env.HOST || 'localhost'

const app = express()

app.use(express.json({ limit: '1mb' }))
app.use('/health', healthRouter)
app.use('/jobs', jobsRouter)
app.use('/queue', queueRouter)

const server = app.listen(PORT, HOST, () => {
  console.log(`categorizer running at http://${HOST}:${PORT}`)
})

let stopping = false
const shutdown = (signal) => {
  if (stopping) {
    process.exit(1)
    return
  }
  stopping = true
  console.log(`Received ${signal}, shutting down`)
  server.close(() => process.exit(0))
  server.closeAllConnections()
  setTimeout(() => process.exit(1), 8000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
