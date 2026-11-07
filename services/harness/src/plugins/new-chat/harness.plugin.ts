import { definePlugin, type PluginDefinition } from 'harness/sdk'

export default definePlugin({
  manifest: { id: 'new-chat', version: '1.0.0', sdkVersion: 1 },
  getModes: () => [{
    id: 'new-chat',
    interaction: 'continuation',
    label: 'New chat',
    hint: 'Summarizes this chat into a handoff prompt and continues it in a new session with the provider and model you choose.',
    base: 'plan',
    promptOptional: true,
    sendLabel: 'Continue in new chat',
    placeholder: 'Optional focus for the handoff summary…',
    buildPrompt: async (ctx, api) => {
      await api.sessions.resolveTarget(ctx.sourceSession.id, {
        provider: ctx.options.provider,
        model: ctx.options.model,
        mode: ctx.options.targetMode,
      })
      return api.prompts.render('newChat', {
        focus: await api.prompts.focus(ctx.prompt, ctx.session, 'new-chat', ctx.promptProvenance),
      }, ctx.session, 'new-chat', ctx.promptProvenance)
    },
    onComplete: async (ctx, result, api) => {
      const prompt = String(result.result || '').trim()
      if (!prompt) throw new Error('new chat: agent returned no continuation prompt')
      const target = await api.sessions.resolveTarget(ctx.sourceSession.id, {
        provider: ctx.options.provider,
        model: ctx.options.model,
        mode: ctx.options.targetMode,
      })
      const next = await api.sessions.continue(ctx.sourceSession.id, prompt, target)
      return { continuation: next }
    },
  }],
} satisfies PluginDefinition)
