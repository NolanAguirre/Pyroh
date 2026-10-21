const path = require('path')
const os = require('os')

// Expand a leading `~` to the current user's home dir. Env-dir files are
// exported verbatim, so `~/personal` would otherwise stay literal.
const expandHome = (raw) => {
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  return raw
}

const resolveWriteDir = () => {
  const raw = process.env.HARNESS_WRITE_DIR || '~/.harness'
  return path.resolve(process.cwd(), expandHome(raw))
}

// Machine-local base path the harness operates within. Work dirs are chosen
// under this and never allowed to escape it.
const resolveWorkBase = () => {
  const raw = process.env.HARNESS_BASE_PATH || path.join(os.homedir(), 'personal')
  return path.resolve(expandHome(raw))
}

const port = Number(process.env.PORT || 6003)

module.exports = {
  writeDir: resolveWriteDir(),
  workBase: resolveWorkBase(),
  host: process.env.HOST || '127.0.0.1',
  port,
  // Unset disables automatic terminal naming.
  categorizerUrl: (process.env.HARNESS_CATEGORIZER_URL || '').trim().replace(/\/+$/, '') || null,
  // Base URL the categorizer uses to call back into this API.
  publicUrl: (process.env.HARNESS_PUBLIC_URL || '').trim().replace(/\/+$/, '') || `http://127.0.0.1:${port}`,
}
