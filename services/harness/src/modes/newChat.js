const MODE = 'new-chat'

const buildPrompt = (focus) => `Summarize the key learnings and context from this chat, record what still needs to happen, and return a prompt for me to continue in another chat.

Your entire final response is sent verbatim as the first message of a fresh chat in the same workspace. That chat has no access to this conversation, so write the response as a self-contained prompt addressed to the next agent:
- Goal: what we are trying to accomplish and why.
- Context and learnings: decisions made, constraints, conventions, gotchas, and relevant files, commands, and identifiers.
- Current state: what has been done and verified, and what is in progress.
- Remaining work: concrete next steps in order, plus open questions.

Do not modify files or run commands that change state. Do not add a preamble or closing remarks outside the prompt.
${focus ? `\nAdditional focus from the operator: ${focus}\n` : ''}`

module.exports = { MODE, buildPrompt }
