const config = require('./config')
const { findTriggers } = require('./prompt/triggers')
const workspaceStore = require('./store/workspaceStore')

const BASE_IGNORE = ['npm', 'jsx', 'tsx', 'sqitch', 'nginx', 'vite', 'devscope', 'qwen', 'gguf', 'repo', 'env', 'cli']

const ignoreWords = async () => {
  const words = new Set(BASE_IGNORE)
  try {
    for (const workspace of await workspaceStore.listWorkspacesAsync(config.writeDir)) {
      const name = String(workspace.name || '').toLowerCase().trim()
      if (!name) continue
      words.add(name)
      for (const part of name.split(/[\s_-]+/)) if (part) words.add(part)
    }
  } catch (err) {
    console.error(`spellcheck: workspace names unavailable: ${err && err.message ? err.message : err}`)
  }
  return [...words]
}

// Waits for the spellcheck service and returns the corrected text. Any
// failure, timeout or missing URL returns the text unchanged.
const correctText = async (text, { steer = false } = {}) => {
  if (!config.spellcheckUrl || typeof text !== 'string' || !text.trim()) return text
  try {
    const res = await fetch(`${config.spellcheckUrl}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        steer,
        triggers: findTriggers(text, { steer }).map(({ start, end }) => ({ start, end })),
        ignore: await ignoreWords(),
      }),
      signal: AbortSignal.timeout(config.spellcheckTimeoutMs),
    })
    if (!res.ok) {
      console.error(`spellcheck: rejected with ${res.status}`)
      return text
    }
    const body = await res.json()
    if (typeof body?.text !== 'string') return text
    if (Array.isArray(body.fixes) && body.fixes.length) {
      console.log(`spellcheck: ${body.fixes.map((fix) => `${fix.from} -> ${fix.to}`).join(', ')}`)
    }
    return body.text
  } catch (err) {
    console.error(`spellcheck: failed: ${err && err.message ? err.message : err}`)
    return text
  }
}

module.exports = { correctText }
