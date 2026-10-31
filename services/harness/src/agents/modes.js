// Turn modes every provider driver accepts. Each driver maps these onto its
// native modes, or emulates them where the provider has no equivalent. Ask is
// enforced read-only: drivers deny any approval request for non-read-only
// work. ASK_PROMPT tells the model why those requests are denied.
const prompts = require('../prompts')

const AGENT_MODES = ['agent', 'plan', 'ask']

const ASK_PROMPT = prompts.text('ask')

const TERSE_PROMPT = prompts.text('terse')

const withAskPrompt = (prompt) => `${ASK_PROMPT}\n\n${prompt}`

// `terse` is the first prompt of a session. Ask and plugin instructions are
// added on every turn.
const composePrompt = (prompt, { mode, terse = false, instructions } = {}) => {
  const text = prompt == null ? '' : String(prompt)
  const parts = []
  if (terse && !text.startsWith(TERSE_PROMPT)) parts.push(TERSE_PROMPT)
  if (mode === 'ask') parts.push(ASK_PROMPT)
  if (instructions) parts.push(String(instructions))
  if (!parts.length) return text
  return `${parts.join('\n\n')}\n\n${text}`
}

module.exports = { AGENT_MODES, ASK_PROMPT, TERSE_PROMPT, withAskPrompt, composePrompt }
