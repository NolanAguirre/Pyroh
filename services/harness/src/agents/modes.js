// Turn modes every provider driver accepts. Each driver maps these onto its
// native modes, or emulates them where the provider has no equivalent.
const AGENT_MODES = ['agent', 'plan', 'ask']

const ASK_PROMPT = 'This is a question, do not change code, do not run commands that will change things, only explore what is required to answer the question.'

const TERSE_PROMPT = 'Respond tersely and use simple language when responding to the user.'

const TERSE_MODES = ['agent', 'plan', 'ask', 'token-waste']

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

module.exports = { AGENT_MODES, ASK_PROMPT, TERSE_PROMPT, TERSE_MODES, withAskPrompt, composePrompt }
