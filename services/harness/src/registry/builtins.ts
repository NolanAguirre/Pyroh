import type { CoreMode, PluginMode, RegistryKind } from '../sdk'

export interface BuiltinMode extends PluginMode { base: CoreMode; kind: 'turn' }
export interface Tool { id: string; label: string; hint: string; modes: string[]; delivery: Record<string, string> }
export interface Panel { id: string; label: string; title: string; icon: string; placement: string; needsWorkspace: boolean }

export const MODES: BuiltinMode[] = [
  {
    id: 'agent',
    label: 'Execute',
    hint: 'Agent executes commands, edits files, and runs tools.',
    base: 'agent',
    kind: 'turn',
    terse: true,
    delegationEligible: true,
    autoName: true,
    snapshot: true,
    sendLabel: 'Send',
    placeholder: 'Ask the agent to do something (⌘↵ to send)…',
  },
  {
    id: 'leader',
    label: 'Leader',
    hint: 'Delegates execution to subagents and keeps this session focused on direction and results.',
    base: 'agent',
    kind: 'turn',
    terse: true,
    delegationEligible: true,
    autoName: true,
    snapshot: true,
    sendLabel: 'Send',
    placeholder: 'Describe the work for the leader to delegate (⌘↵ to send)…',
  },
  {
    id: 'ask',
    label: 'Ask',
    hint: 'Answers a question by exploring the code without changing anything.',
    base: 'ask',
    kind: 'turn',
    terse: true,
    delegationEligible: true,
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
    delegationEligible: true,
    autoName: true,
    snapshot: true,
    savePlan: true,
    sendLabel: 'Plan',
    placeholder: 'Describe what you want to plan (read-only)…',
  },

]

// `modes: ['*']` opts a tool into every mode, plugin modes included.
// `delivery` documents how each provider receives it; drivers own the wiring.
export const TOOLS: Tool[] = [
  {
    id: 'ask_user',
    label: 'Ask user',
    hint: 'Lets the agent ask the operator a question and wait for the answer.',
    modes: ['*'],
    delivery: { cursor: 'custom tool ask_user', codex: 'dynamic tool harness_ask_user', claude: 'AskUserQuestion and approvals', grok: 'permission requests' },
  },
  {
    id: 'create_memory',
    label: 'Create memory',
    hint: 'Writes a proposed memory through the mcp-memory service.',
    modes: ['memory-extract'],
    delivery: { cursor: 'MCP harness_memory', codex: 'MCP harness_memory', claude: 'MCP harness_memory', grok: 'MCP harness_memory' },
  },
]

// `page` panels replace the whole layout; `main` panels replace the main pane
// and toggle. The UI maps ids to components.
export const PANELS: Panel[] = [
  { id: 'editor', label: 'Editor', title: 'Open the file editor for this workspace', icon: 'editor', placement: 'page', needsWorkspace: true },
  { id: 'terminal', label: 'Terminal', title: 'Open a terminal for this workspace', icon: 'terminal', placement: 'page', needsWorkspace: true },
  { id: 'git', label: 'Git', title: 'Open git for this workspace', icon: 'git', placement: 'page', needsWorkspace: true },
  { id: 'code-stats', label: 'Code stats', title: 'Show file length stats for this workspace', icon: 'codeStats', placement: 'main', needsWorkspace: true },
  { id: 'analytics', label: 'Analytics', title: 'Open tool-call analytics', icon: 'analytics', placement: 'page', needsWorkspace: false },
  { id: 'memories', label: 'Memories', title: 'View extracted memories', icon: 'memory', placement: 'page', needsWorkspace: false },
  { id: 'registry', label: 'Registry', title: 'Show loaded plugins, rules, modes, tools, and panels', icon: 'registry', placement: 'page', needsWorkspace: false },
]

// Rules cannot deny these; the harness needs somewhere to run a turn, and the
// registry panel is how you see why something was denied.
export const LOCKED: Record<RegistryKind, string[]> = { mode: ['agent'], tool: [], panel: ['registry'] }
