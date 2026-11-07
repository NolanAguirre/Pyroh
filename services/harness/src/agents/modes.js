// Shared turn modes resolve prompts and native behavior through providerModes.
const prompts = require('../prompts')

const { providerMode } = require('./providerModes')

const AGENT_MODES = ['agent', 'plan', 'ask']

// Read on each call so operator edits apply without a restart.
const askPrompt = (provider, context = {}) => prompts.text('ask', provider, context)

const tersePrompt = (provider, context = {}) => prompts.text('terse', provider, context)

const withAskPrompt = (prompt, provider, context = {}) => `${askPrompt(provider, context)}\n\n${prompt}`

// `terse` is the first prompt of a session. Ask and plugin instructions are
// added on every turn.
const composePrompt = (prompt, { mode = 'agent', logicalMode = mode, model, terse = false, instructions, provider } = {}) => {
  const text = prompt == null ? '' : String(prompt)
  const parts = []
  const context = { model, mode: logicalMode }
  const terseText = tersePrompt(provider, context)
  if (terse && !text.startsWith(terseText)) parts.push(terseText)
  const promptIds = provider ? providerMode(provider, mode).prompts : mode === 'ask' ? ['ask'] : []
  const basePromptIds = mode === 'agent' || mode === 'plan' ? [mode] : []
  for (const id of [...new Set([...basePromptIds, ...promptIds])]) {
    const content = prompts.text(id, provider, context)
    if (content) parts.push(content)
  }
  if (instructions) parts.push(String(instructions))
  if (!parts.length) return text
  return `${parts.join('\n\n')}\n\n${text}`
}

module.exports = { AGENT_MODES, askPrompt, tersePrompt, withAskPrompt, composePrompt }
