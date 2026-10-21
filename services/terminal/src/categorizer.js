const config = require('./config')

const REQUEST_TIMEOUT_MS = 5000

const errorText = (err) => (err && err.message ? err.message : err)

// Fire-and-forget: naming is cosmetic, so failures are logged and never
// reach the shell that triggered them.
const requestTerminalName = (terminalId, command) => {
  if (!config.categorizerUrl || typeof command !== 'string' || !command.trim()) return
  try {
    const body = {
      task: 'terminal-name',
      key: terminalId,
      input: command,
      callback: {
        url: `${config.publicUrl}/api/terminal/${encodeURIComponent(terminalId)}/auto-name`,
        method: 'POST',
      },
    }
    fetch(`${config.categorizerUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) console.error(`categorizer: terminal-name for ${terminalId} rejected with ${res.status}`)
      })
      .catch((err) => {
        console.error(`categorizer: terminal-name for ${terminalId} failed: ${errorText(err)}`)
      })
  } catch (err) {
    console.error(`categorizer: terminal-name for ${terminalId} failed: ${errorText(err)}`)
  }
}

module.exports = { requestTerminalName }
