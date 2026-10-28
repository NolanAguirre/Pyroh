const { ASK_PROMPT, TERSE_PROMPT } = require('../agents/modes')

// What each mode flag does, for the Registry panel. `text` is the exact prompt
// text the flag adds to turns; `test` picks the modes that include it.
const FLAGS = [
  {
    id: 'terse',
    label: 'terse',
    description: 'Prepended to the first prompt of a session.',
    text: TERSE_PROMPT,
    test: (mode) => mode.terse,
  },
  {
    id: 'ask',
    label: 'ask base',
    description: 'Prepended to every turn of modes built on Ask. Drivers also deny any approval request that is not read-only.',
    text: ASK_PROMPT,
    test: (mode) => mode.base === 'ask',
  },
  {
    id: 'instructions',
    label: 'instructions',
    description: 'Plugin instructions, prepended to every turn of the mode. Function instructions are built per run.',
    text: null,
    test: (mode) => Boolean(mode.instructions),
  },
  {
    id: 'promptOptional',
    label: 'prompt optional',
    description: 'The mode can be sent with an empty prompt.',
    text: null,
    test: (mode) => mode.promptOptional,
  },
  {
    id: 'newSession',
    label: 'new session',
    description: 'Runs in a new sibling session instead of the current one.',
    text: null,
    test: (mode) => mode.newSession,
  },
  {
    id: 'autoName',
    label: 'auto name',
    description: 'The first typed prompt names an unnamed session.',
    text: null,
    test: (mode) => mode.autoName,
  },
  {
    id: 'snapshot',
    label: 'snapshot',
    description: 'Commits a git snapshot of the workspace before the run.',
    text: null,
    test: (mode) => mode.snapshot,
  },
  {
    id: 'savePlan',
    label: 'save plan',
    description: 'Saves the final result as a plan.',
    text: null,
    test: (mode) => mode.savePlan,
  },
  {
    id: 'notSteerable',
    label: 'not steerable',
    description: 'Messages cannot be sent into a running session of this mode.',
    text: null,
    test: (mode) => mode.steerable === false,
  },
]

// Each flag with the ids of the modes that include it.
const describeFlags = (modes) => FLAGS.map(({ test, ...flag }) =>
  ({ ...flag, modes: modes.filter(test).map((mode) => mode.id) }))

module.exports = { FLAGS, describeFlags }
