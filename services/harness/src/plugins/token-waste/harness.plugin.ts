import { definePlugin, type PluginDefinition } from 'harness/sdk'

export default definePlugin({
  manifest: { id: 'token-waste', version: '1.0.0', sdkVersion: 1 },
  getModes: () => [{
    id: 'token-waste',
    label: 'Token waste',
    hint: 'Explains token usage and records patterns for harness investigation over time.',
    base: 'ask',
    promptOptional: true,
    newSession: true,
    sessionName: 'Token waste',
    sendLabel: 'Analyze transcript',
    placeholder: 'Optional focus or instructions for token-waste analysis…',
    buildPrompt: async (ctx, api) => api.prompts.render('tokenWaste', {
      sessionId: ctx.sourceSession.id,
      directories: await api.transcripts.describe(ctx.sourceSession.id, 'directories'),
      focus: await api.prompts.focus(ctx.prompt, ctx.session, 'token-waste', ctx.promptProvenance),
    }, ctx.session, 'token-waste', ctx.promptProvenance),
  }],
} satisfies PluginDefinition)
