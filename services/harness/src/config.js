const path = require('path')
const os = require('os')
const fs = require('fs')

const HARNESS_DB_PATH = process.env.HARNESS_DB_PATH

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

// Machine-local default work dir. Relative work dirs resolve against it; any
// dir under the home dir is allowed.
const resolveWorkBase = () => {
  const raw = process.env.HARNESS_BASE_PATH || path.join(os.homedir(), 'personal')
  return path.resolve(expandHome(raw))
}

const resolveBin = (envName, name, fallbacks = []) => {
  const explicit = (process.env[envName] || '').trim()
  if (explicit) return expandHome(explicit)
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = (process.env.PATH || '').split(path.delimiter)
    .filter(Boolean).map((dir) => path.resolve(dir, executable))
  candidates.push(...fallbacks)
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Continue discovery; explicit overrides above never silently fall back.
    }
  }
  return executable
}

const port = Number(process.env.PORT || 6000)

const config = {
  writeDir: resolveWriteDir(),
  workBase: resolveWorkBase(),
  // Resolved from the source tree so daemons spawned with another cwd share it.
  dbPath: HARNESS_DB_PATH
    ? path.resolve(expandHome(HARNESS_DB_PATH))
    : path.resolve(__dirname, '..', '..', '..', 'db', 'harness', 'harness.sqlite'),
  cursorApiKey: (process.env.CURSOR_API_KEY || '').trim(),
  // The desktop bundles Codex without necessarily adding it to service PATHs.
  codexBin: resolveBin('HARNESS_CODEX_BIN', 'codex',
    process.platform === 'linux' ? ['/usr/lib/chatgpt/resources/codex'] : []),
  grokBin: resolveBin('HARNESS_GROK_BIN', 'grok', [path.join(os.homedir(), '.local', 'bin', 'grok')]),
  // Unset uses the Claude Code binary bundled with the Agent SDK, which matches its protocol version.
  claudeBin: (process.env.HARNESS_CLAUDE_BIN || '').trim() ? expandHome(process.env.HARNESS_CLAUDE_BIN.trim()) : null,
  codexHome: process.env.HARNESS_CODEX_HOME ? path.resolve(expandHome(process.env.HARNESS_CODEX_HOME)) : null,
  codexApiKey: (process.env.HARNESS_CODEX_API_KEY || '').trim(),
  host: process.env.HOST || '0.0.0.0',
  port,
  // Unset disables automatic chat naming.
  categorizerUrl: (process.env.HARNESS_CATEGORIZER_URL || '').trim().replace(/\/+$/, '') || null,
  // Unset disables analytics (tool-stats and run notifications).
  analyticsUrl: (process.env.HARNESS_ANALYTICS_URL || '').trim().replace(/\/+$/, '') || null,
  // Base URL the categorizer uses to call back into this API.
  publicUrl: (process.env.HARNESS_PUBLIC_URL || '').trim().replace(/\/+$/, '') || `http://localhost:${port}`,
}

module.exports = config
