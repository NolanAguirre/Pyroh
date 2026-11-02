// Provider implementations of the shared base modes. Tool policy describes
// native tools; harness custom tools remain governed by the tool registry.
const PROVIDER_MODES = {
  codex: {
    agent: { nativeMode: 'default', prompts: [], tools: { commands: 'configured', fileChanges: 'configured', permissions: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Configured Codex tools and approvals.' },
    plan: { nativeMode: 'plan', prompts: [], tools: { commands: 'configured', fileChanges: 'configured', permissions: 'configured' }, approvalPolicy: null, sandbox: null, description: 'Native Codex planning with configured approvals.' },
    ask: { nativeMode: 'default', prompts: ['ask'], tools: { commands: 'allow', fileChanges: 'deny', permissions: 'deny' }, approvalPolicy: 'untrusted', sandbox: null, description: 'Command execution stays available for file reads. The ask prompt prohibits mutations; this is not a command-level read-only guarantee.' },
  },
}

const providerMode = (provider, mode = 'agent') => {
  const entry = PROVIDER_MODES[provider]?.[mode]
  if (!entry) throw new Error(`unsupported provider mode: ${provider}/${mode}`)
  return { ...entry, prompts: [...entry.prompts], tools: { ...entry.tools } }
}

const describeProviderModes = (mode, provider) => Object.fromEntries(
  (provider ? [provider] : Object.keys(PROVIDER_MODES)).map((id) => [id, providerMode(id, mode)]))

module.exports = { PROVIDER_MODES, providerMode, describeProviderModes }
