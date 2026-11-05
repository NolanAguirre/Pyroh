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

let ignoreCache = null
let ignoreExpiresAt = 0
const cachedIgnoreWords = () => {
  if (!ignoreCache || Date.now() >= ignoreExpiresAt) {
    ignoreExpiresAt = Date.now() + 60000
    ignoreCache = ignoreWords()
  }
  return ignoreCache
}

// Attempt spellcheck for every prompt when configured. A failed request returns
// the original text without disabling spellcheck for later prompts.
const correctText = async (text, { first = true } = {}) => {
  if (!config.spellcheckUrl || typeof text !== 'string' || !text.trim()) return text
  const controller = new AbortController()
  let timer
  try {
    const request = async () => {
      const ignore = await cachedIgnoreWords()
      if (controller.signal.aborted) return text
      const res = await fetch(`${config.spellcheckUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          first,
          triggers: findTriggers(text, { first }).map(({ start, end }) => ({ start, end })),
          ignore,
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`rejected with ${res.status}`)
      const body = await res.json()
      if (typeof body?.text !== 'string') return text
      if (Array.isArray(body.fixes) && body.fixes.length) {
        console.log(`spellcheck: ${body.fixes.map((fix) => `${fix.from} -> ${fix.to}`).join(', ')}`)
      }
      return body.text
    }
    // Bound the whole operation, including workspace lookup and response body.
    return await Promise.race([
      request(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('deadline exceeded; sending original text'))
        }, config.spellcheckTimeoutMs)
      }),
    ])
  } catch (err) {
    console.error(`spellcheck: failed: ${err && err.message ? err.message : err}`)
    return text
  } finally { clearTimeout(timer) }
}

module.exports = { correctText }
