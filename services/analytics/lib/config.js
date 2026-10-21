const path = require('path')
const os = require('os')

// Expand a leading `~` to the current user's home dir. Env-dir files are
// exported verbatim, so `~/.harness` would otherwise stay literal.
const expandHome = (raw) => {
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

const positiveInt = (raw, fallback) => {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const config = {
  host: process.env.HOST || 'localhost',
  port: Number(process.env.PORT || 6006),
  databaseUrl: (process.env.DATABASE_URL || '').trim() || 'postgresql://postgres@localhost:5432/analytics',
  harnessWriteDir: path.resolve(process.cwd(), expandHome((process.env.HARNESS_WRITE_DIR || '').trim() || '~/.harness')),
  computeConcurrency: positiveInt(process.env.COMPUTE_CONCURRENCY, 4),
}

module.exports = config
