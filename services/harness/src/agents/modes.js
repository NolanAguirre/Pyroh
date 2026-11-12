// Shared turn modes resolve prompts and native behavior through providerModes.
const prompts = require('../prompts')
const provenance = require('../prompt/provenance')

const { providerMode } = require('./providerModes')

const AGENT_MODES = ['agent', 'plan', 'ask']

// Read on each call so operator edits apply without a restart.
const askPrompt = (provider, context = {}) => prompts.text('ask', provider, context)

const tersePrompt = (provider, context = {}) => prompts.text('terse', provider, context)

const withAskPrompt = (prompt, provider, context = {}) => `${askPrompt(provider, context)}\n\n${prompt}`

// First-message instructions are handled by prompt/rewrite. Mode and plugin
// instructions are added on every turn.
const composePromptWithProvenance = (prompt, { mode = 'agent', logicalMode = mode, model, instructions, provider, promptProvenance, promptContext = {} } = {}) => {
  const text = prompt == null ? '' : String(prompt)
  const parts = []
  const context = { ...promptContext, model, mode: logicalMode, messageType: promptProvenance?.messageType ?? 'user' }
  const promptIds = provider ? providerMode(provider, mode).prompts : mode === 'ask' ? ['ask'] : []
  const basePromptIds = mode === 'agent' || mode === 'plan' ? [mode] : []
  for (const id of [...new Set([...basePromptIds, ...promptIds])]) {
    const content = prompts.text(id, provider, context)
    if (content) parts.push(provenance.section('system', `${id} instructions`, content))
  }
  if (instructions && context.messageType !== 'agent') parts.push(provenance.section('system', 'Harness, plugin and delegation instructions', instructions))
  return provenance.prepend(parts, provenance.supplied(text, promptProvenance))
}

const composePrompt = (prompt, options) => composePromptWithProvenance(prompt, options).text

module.exports = { AGENT_MODES, askPrompt, tersePrompt, withAskPrompt, composePrompt, composePromptWithProvenance }
