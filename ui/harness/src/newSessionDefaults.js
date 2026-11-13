export const DEFAULT_PROVIDER = 'codex'
export const DEFAULT_CODEX_SETTINGS = { reasoningEffort: 'high', sandbox: 'danger-full-access', approvalPolicy: 'never', webSearch: 'cached' }
export const DEFAULT_GROK_SETTINGS = { reasoningEffort: '' }
export const DEFAULT_CLAUDE_SETTINGS = { reasoningEffort: '', permissionMode: 'bypassPermissions' }

export const defaultSessionOptions = (providers) => {
  const provider = providers.find((item) => item.id === DEFAULT_PROVIDER) || providers[0]
  return {
    provider: provider?.id || DEFAULT_PROVIDER,
    model: provider?.models?.[0]?.id || null,
    ...(provider?.id === 'codex' ? { codex: { ...DEFAULT_CODEX_SETTINGS } } : {}),
    ...(provider?.id === 'grok' ? { grok: { ...DEFAULT_GROK_SETTINGS } } : {}),
    ...(provider?.id === 'claude' ? { claude: { ...DEFAULT_CLAUDE_SETTINGS } } : {}),
  }
}
