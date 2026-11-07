import { definePlugin, type PluginDefinition } from '../../sdk'

export default definePlugin({
  manifest: { id: 'fork', version: '1.0.0', sdkVersion: 1 },
  getModes: () => [{
    id: 'fork',
    label: 'Fork',
    hint: 'Starts an independent conversation from this chat’s full history, keeping its current mode and settings.',
    base: 'agent',
    terse: false,
    delegationEligible: false,
    autoName: false,
    snapshot: false,
    savePlan: false,
    newSession: false,
    steerable: false,
    sendLabel: 'Send to fork',
    placeholder: 'Start a fork from this conversation…',
    launch: (ctx, api) => {
      if (ctx.options.runAfterSessionId) {
        throw Object.assign(new Error('Fork cannot be scheduled with run after'), { status: 400 })
      }
      return api.sessions.fork(ctx.sourceSession.id, {
        prompt: ctx.prompt,
        forkRetryKey: ctx.options.forkRetryKey,
        promptProvenance: ctx.promptProvenance,
      })
    },
  }],
} satisfies PluginDefinition)
