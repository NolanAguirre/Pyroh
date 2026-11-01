const express = require('express')
const { checkText, loadSpell } = require('./lib/check')
const { sweepDone } = require('./lib/queue')

const PORT = Number(process.env.PORT || 6010)
const HOST = process.env.HOST || 'localhost'
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 9000)
const SWEEP_INTERVAL_MS = 60000

const app = express()

app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', queue_dir: process.env.QUEUE_DIR || null })
})

// Body: { text, triggers: [{ start, end }], ignore: [word], steer }.
// Replies { text, fixes }; any failure replies with the text unchanged.
app.post('/check', async (req, res) => {
  const { text, triggers, ignore, steer } = req.body || {}
  if (typeof text !== 'string') return res.status(400).json({ error: 'text must be a string' })
  try {
    res.json(await checkText(text, {
      triggers: Array.isArray(triggers) ? triggers : [],
      ignore: Array.isArray(ignore) ? ignore : [],
      steer: steer === true,
      timeoutMs: JOB_TIMEOUT_MS,
    }))
  } catch (error) {
    console.error('spellcheck failed:', error)
    res.json({ text, fixes: [] })
  }
})

loadSpell().catch((error) => console.error('dictionary load failed:', error))
setInterval(() => sweepDone(SWEEP_INTERVAL_MS).catch(() => {}), SWEEP_INTERVAL_MS).unref()

const server = app.listen(PORT, HOST, () => {
  console.log(`spellcheck running at http://${HOST}:${PORT}`)
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
