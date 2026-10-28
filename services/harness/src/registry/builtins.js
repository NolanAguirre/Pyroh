// Built-in registry entries. Their ids are reserved: global and workspace
// plugins cannot replace them, only rules can deny them (except LOCKED).
//
// Mode `kind` picks the code path that runs it:
//   turn         one agent turn in the session
//   token-waste  analysis turn in a new sibling session
//   new-chat     handoff summary, then a new session continues it
//   decompose    multi-phase decompose pipeline
//   plugin       plugin buildPrompt/instructions/onComplete
const MODES = [
  {
    id: 'agent',
    label: 'Execute',
    hint: 'Agent executes commands, edits files, and runs tools.',
    base: 'agent',
    kind: 'turn',
    terse: true,
    autoName: true,
    snapshot: true,
    sendLabel: 'Send',
    placeholder: 'Ask the agent to do something (⌘↵ to send)…',
  },
  {
    id: 'ask',
    label: 'Ask',
    hint: 'Answers a question by exploring the code without changing anything.',
    base: 'ask',
    kind: 'turn',
    terse: true,
    autoName: true,
    snapshot: false,
    sendLabel: 'Ask',
    placeholder: 'Ask a question about the code…',
  },
  {
    id: 'plan',
    label: 'Plan',
    hint: 'Read-only analysis and architectural planning without modifying files.',
    base: 'plan',
    kind: 'turn',
    terse: true,
    autoName: true,
    snapshot: true,
    savePlan: true,
    sendLabel: 'Plan',
    placeholder: 'Describe what you want to plan (read-only)…',
  },
  {
    id: 'decompose',
    label: 'Decompose',
    hint: 'Recursively decomposes high-level goals into phased steps.',
    base: 'plan',
    kind: 'decompose',
    steerable: false,
    sendLabel: 'Decompose',
    placeholder: 'Paste a high-level plan to decompose into sub-phases…',
  },
  {
    id: 'token-waste',
    label: 'Token waste',
    hint: 'Analyzes transcript tokens and highlights waste or redundancy.',
    base: 'plan',
    kind: 'token-waste',
    terse: true,
    promptOptional: true,
    newSession: true,
    snapshot: false,
    sessionName: 'Token waste',
    sendLabel: 'Analyze transcript',
    placeholder: 'Optional focus or instructions for token-waste analysis…',
  },
  {
    id: 'new-chat',
    label: 'New chat',
    hint: 'Summarizes this chat into a handoff prompt and continues it in a new session with the provider and model you choose.',
    base: 'plan',
    kind: 'new-chat',
    promptOptional: true,
    snapshot: false,
    sendLabel: 'Continue in new chat',
    placeholder: 'Optional focus for the handoff summary…',
  },
]

// `modes: ['*']` opts a tool into every mode, plugin modes included.
// `delivery` documents how each provider receives it; drivers own the wiring.
const TOOLS = [
  {
    id: 'ask_user',
    label: 'Ask user',
    hint: 'Lets the agent ask the operator a question and wait for the answer.',
    modes: ['*'],
    delivery: { cursor: 'custom tool ask_user', codex: 'dynamic tool harness_ask_user', claude: 'AskUserQuestion and approvals', grok: 'permission requests' },
  },
]

// `page` panels replace the whole layout; `main` panels replace the main pane
// and toggle. The UI maps ids to components.
const PANELS = [
  { id: 'editor', label: 'Editor', title: 'Open the file editor for this workspace', icon: 'editor', placement: 'page', needsWorkspace: true },
  { id: 'terminal', label: 'Terminal', title: 'Open a terminal for this workspace', icon: 'terminal', placement: 'page', needsWorkspace: true },
  { id: 'git', label: 'Git', title: 'Open git for this workspace', icon: 'git', placement: 'page', needsWorkspace: true },
  { id: 'code-stats', label: 'Code stats', title: 'Show file length stats for this workspace', icon: 'codeStats', placement: 'main', needsWorkspace: true },
  { id: 'analytics', label: 'Analytics', title: 'Open tool-call analytics', icon: 'analytics', placement: 'page', needsWorkspace: false },
  { id: 'registry', label: 'Registry', title: 'Show loaded plugins, rules, modes, tools, and panels', icon: 'registry', placement: 'page', needsWorkspace: false },
]

// Rules cannot deny these; the harness needs somewhere to run a turn, and the
// registry panel is how you see why something was denied.
const LOCKED = { mode: ['agent'], tool: [], panel: ['registry'] }

module.exports = { MODES, TOOLS, PANELS, LOCKED }
