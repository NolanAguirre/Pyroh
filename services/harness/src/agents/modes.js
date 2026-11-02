// Shared turn modes resolve prompts and native behavior through providerModes.
const prompts = require('../prompts')

const { providerMode } = require('./providerModes')

const AGENT_MODES = ['agent', 'plan', 'ask']

// Read on each call so operator edits apply without a restart.
const askPrompt = (provider) => prompts.text('ask', provider)

const tersePrompt = (provider) => prompts.text('terse', provider)

const withAskPrompt = (prompt, provider) => `${askPrompt(provider)}\n\n${prompt}`

// `terse` is the first prompt of a session. Ask and plugin instructions are
// added on every turn.
const composePrompt = (prompt, { mode, terse = false, instructions, provider } = {}) => {
  const text = prompt == null ? '' : String(prompt)
  const parts = []
  const terseText = tersePrompt(provider)
  if (terse && !text.startsWith(terseText)) parts.push(terseText)
  const promptIds = provider ? providerMode(provider, mode).prompts : mode === 'ask' ? ['ask'] : []
  for (const id of promptIds) parts.push(prompts.text(id, provider))
  if (instructions) parts.push(String(instructions))
  if (!parts.length) return text
  return `${parts.join('\n\n')}\n\n${text}`
}

module.exports = { AGENT_MODES, askPrompt, tersePrompt, withAskPrompt, composePrompt }
