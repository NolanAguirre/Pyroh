const config = require('./config')

const REQUEST_TIMEOUT_MS = 5000

// Fire-and-forget: naming is cosmetic, so failures are logged and never
// propagate into the run that triggered them.
const requestChatName = (sessionId, prompt) => {
  if (!config.categorizerUrl || typeof prompt !== 'string' || !prompt.trim()) return
  try {
    const body = {
      task: 'chat-name',
      key: sessionId,
      input: prompt,
      callback: {
        url: `${config.publicUrl}/api/sessions/${encodeURIComponent(sessionId)}/auto-name`,
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
        if (!res.ok) console.error(`categorizer: chat-name for ${sessionId} rejected with ${res.status}`)
      })
      .catch((err) => {
        console.error(`categorizer: chat-name for ${sessionId} failed: ${err && err.message ? err.message : err}`)
      })
  } catch (err) {
    console.error(`categorizer: chat-name for ${sessionId} failed: ${err && err.message ? err.message : err}`)
  }
}

module.exports = { requestChatName }
