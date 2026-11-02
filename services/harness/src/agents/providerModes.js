// Provider implementations of the shared base modes. Tool policy describes
// native tools; harness custom tools remain governed by the tool registry.
const PROVIDER_MODES = {
  cursor: {
    agent: { nativeMode: 'agent', prompts: [], tools: { disallowed: [] }, approvalPolicy: null, sandbox: null, description: 'Native Cursor agent tools.' },
    plan: { nativeMode: 'plan', prompts: [], tools: { disallowed: [] }, approvalPolicy: null, sandbox: null, description: 'Native Cursor planning.' },
    ask: { nativeMode: 'agent', prompts: ['ask'], tools: { disallowed: ['edit', 'delete', 'shell', 'applyAgentDiff', 'task', 'generateImage'] }, approvalPolicy: null, sandbox: null, description: 'Read tools remain available; mutation tools are removed on create and resume. Harness MCP tools keep their registry policy.' },
  },
  claude: {
    agent: { nativeMode: 'configured', prompts: [], tools: { disallowed: [], approvals: 'configured', savedAllowRules: true }, approvalPolicy: null, sandbox: null, description: 'Configured Claude permission mode and saved grants.' },
    plan: { nativeMode: 'plan', prompts: [], tools: { disallowed: [], approvals: 'configured', savedAllowRules: true }, approvalPolicy: null, sandbox: null, description: 'Native Claude planning; the harness records the plan and denies ExitPlanMode.' },
    ask: { nativeMode: 'default', prompts: ['ask'], tools: { disallowed: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], approvals: 'deny', savedAllowRules: false }, approvalPolicy: null, sandbox: null, description: 'Edit tools and approval requests are denied. Read tools and Bash can bypass approval; the prompt forbids changes. Harness tools remain available.' },
  },
  grok: {
    agent: { nativeMode: 'default', prompts: [], tools: { approvals: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Native Grok default mode.' },
    plan: { nativeMode: 'plan', prompts: [], tools: { approvals: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Native Grok planning.' },
    ask: { nativeMode: 'default', prompts: ['ask'], tools: { approvals: 'deny' }, approvalPolicy: null, sandbox: null, description: 'Approval requests are denied except harness tools. Grok allow rules may bypass approvals; the prompt forbids changes.' },
  },
  codex: {
    agent: { nativeMode: 'default', prompts: [], tools: { commands: 'configured', fileChanges: 'configured', permissions: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Configured Codex tools and approvals.' },
    plan: { nativeMode: 'plan', prompts: [], tools: { commands: 'configured', fileChanges: 'configured', permissions: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Native Codex planning with configured approvals.' },
    ask: { nativeMode: 'default', prompts: ['ask'], tools: { commands: 'allow', fileChanges: 'deny', permissions: 'deny' }, approvalPolicy: 'untrusted', sandbox: null, description: 'Command execution stays available for file reads. The ask prompt prohibits mutations; this is not a command-level read-only guarantee.' },
  },
}

for (const modes of Object.values(PROVIDER_MODES)) {
  for (const mode of ['agent', 'plan', 'ask']) {
    const entry = modes[mode]
    if (!entry || !entry.nativeMode || !Array.isArray(entry.prompts) || !entry.tools) {
      throw new Error(`invalid provider mode definition: ${mode}`)
    }
    for (const value of Object.values(entry.tools)) if (Array.isArray(value)) Object.freeze(value)
    Object.freeze(entry.tools)
    Object.freeze(entry.prompts)
    Object.freeze(entry)
  }
  Object.freeze(modes)
}
Object.freeze(PROVIDER_MODES)

const providerMode = (provider, mode = 'agent') => {
  const entry = PROVIDER_MODES[provider]?.[mode]
  if (!entry) throw new Error(`unsupported provider mode: ${provider}/${mode}`)
  return { ...entry, prompts: [...entry.prompts], tools: Object.fromEntries(
    Object.entries(entry.tools).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) }
}

const describeProviderModes = (mode, provider) => Object.fromEntries(
  (provider ? [provider] : Object.keys(PROVIDER_MODES)).map((id) => [id, providerMode(id, mode)]))

module.exports = { PROVIDER_MODES, providerMode, describeProviderModes }
