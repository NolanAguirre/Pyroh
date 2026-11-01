// Turn modes every provider driver accepts. Each driver maps these onto its
// native modes, or emulates them where the provider has no equivalent. Ask is
// enforced read-only: drivers deny any approval request for non-read-only
// work. The ask prompt tells the model why those requests are denied.
const prompts = require('../prompts')

const AGENT_MODES = ['agent', 'plan', 'ask']

// Read on each call so operator edits apply without a restart.
const askPrompt = () => prompts.text('ask')

const tersePrompt = () => prompts.text('terse')

const withAskPrompt = (prompt) => `${askPrompt()}\n\n${prompt}`

// `terse` is the first prompt of a session. Ask and plugin instructions are
// added on every turn.
const composePrompt = (prompt, { mode, terse = false, instructions } = {}) => {
  const text = prompt == null ? '' : String(prompt)
  const parts = []
  const terseText = tersePrompt()
  if (terse && !text.startsWith(terseText)) parts.push(terseText)
  if (mode === 'ask') parts.push(askPrompt())
  if (instructions) parts.push(String(instructions))
  if (!parts.length) return text
  return `${parts.join('\n\n')}\n\n${text}`
}

module.exports = { AGENT_MODES, askPrompt, tersePrompt, withAskPrompt, composePrompt }
