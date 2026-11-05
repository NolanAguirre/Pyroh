import { devIds } from './triggers/devIds.js'
import { devIdPaths } from './triggers/devIdPaths.js'

// Keep command matching and help text together as the command list grows.
export const INPUT_COMMANDS = [
  {
    type: 'help',
    usage: 'help',
    label: 'Show help',
    description: 'List all harness input commands in this session’s transcript. No agent is started. You can also use /help.',
    pattern: /^(?:help|\/help)$/i,
  },
  {
    type: 'analyze-subagent',
    usage: 'analyze subagent [shared=<tokens>] [requests=<count>] [output=<tokens>]',
    label: 'Analyze subagents',
    description: 'Save measured usage for this session (or its source) and its delegation subtree in the transcript. Averages use model requests, not tool calls. Optional whole-number assumptions enable a rough combined-agent comparison: shared is the total shared starting-context deduction, requests is the combined request count, and output is combined output. Missing evidence stays unknown.',
    pattern: /^analyze\s+subagent(?:\s+(.*))?$/i,
    arguments: (match) => ({ assumptions: (match[1] || '').trim() }),
  },
  {
    type: 'create-checkpoint',
    usage: 'create checkpoint <name>',
    label: 'Create checkpoint',
    description: 'Save an analytics checkpoint at the current time. Use its name in the analytics date filter. A name is required and can contain spaces, up to 200 characters.',
    pattern: /^create\s+checkpoint(?:\s+(.*))?$/i,
    arguments: (match) => ({ name: (match[1] || '').trim() }),
  },
]

export const inputCommandHelp = () => [
  '# THIS IS NOT AN AGENT, THIS IS A HARNESS HELP MODE',
  '',
  'Enter a command by itself on one line in the message box. Commands are case-insensitive and run in the harness without contacting an agent.',
  '',
  ...INPUT_COMMANDS.flatMap((command) => [
    `### ${command.usage}`,
    command.description,
    '',
  ]),
].join('\n').trimEnd()

// Commands occupy the entire input; mentions inside prose or multiline prompts
// remain ordinary agent input. Keep a bare command recognizable for validation.
export const parseInputCommand = (text) => {
  if (typeof text !== 'string' || /[\r\n\u2028\u2029]/.test(text)) return null
  for (const command of INPUT_COMMANDS) {
    const match = command.pattern.exec(text.trim())
    if (match) return { type: command.type, ...command.arguments?.(match) }
  }
  return null
}

// Pure and synchronous: the UI runs this on every keystroke and the server
// runs it before each turn. Patterns need the `g` flag.
//
// scope: 'message' applies to every user message (prompts, follow-ups,
// queued messages, steers, answers); 'first' only to the first prompt sent
// to a new agent or subagent.
export const TRIGGERS = [devIds, devIdPaths]

export const inScope = (trigger, { first = true } = {}) => first || trigger.scope !== 'first'

// Matches from every applicable trigger, sorted by position. When matches
// overlap, the earlier (then longer) one wins. `first: false` skips
// first-prompt-only triggers.
export const findTriggers = (text, options = {}) => {
  if (typeof text !== 'string' || !text) return []
  const matches = []
  for (const trigger of TRIGGERS) {
    if (!inScope(trigger, options)) continue
    for (const pattern of trigger.patterns) {
      for (const match of text.matchAll(pattern)) {
        if (!match[0]) continue
        matches.push({ id: trigger.id, start: match.index, end: match.index + match[0].length, text: match[0] })
      }
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const out = []
  for (const match of matches) {
    if (out.length && match.start < out[out.length - 1].end) continue
    out.push(match)
  }
  return out
}

export const hasTrigger = (text, id, options) => findTriggers(text, options).some((match) => match.id === id)
