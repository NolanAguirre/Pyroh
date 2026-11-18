const path = require('path')
const os = require('os')

const HARNESS_DB_PATH = process.env.HARNESS_DB_PATH

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
  harnessDbPath: HARNESS_DB_PATH
    ? path.resolve(expandHome(HARNESS_DB_PATH))
    : path.resolve(__dirname, '../../../db/harness/harness.sqlite'),
  computeConcurrency: positiveInt(process.env.COMPUTE_CONCURRENCY, 4),
}

module.exports = config
