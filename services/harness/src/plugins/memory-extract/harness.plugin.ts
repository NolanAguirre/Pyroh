import { definePlugin, type PluginDefinition } from 'harness/sdk'

export default definePlugin({
  manifest: { id: 'memory-extract', version: '1.0.0', sdkVersion: 1 },
  getModes: () => [{
    id: 'memory-extract',
    label: 'Memories',
    hint: 'Reads the transcript and records proposed memories through the memory MCP.',
    base: 'ask',
    promptOptional: true,
    newSession: true,
    tools: ['create_memory'],
    sessionName: 'Memories',
    sendLabel: 'Extract memories',
    placeholder: 'Optional focus for memory extraction…',
    buildPrompt: async (ctx, api) => {
      if (!api.capabilities.memory) {
        throw Object.assign(new Error('memory extraction needs HARNESS_MEMORY_MCP_URL (the mcp-memory service)'), { status: 400 })
      }
      return api.prompts.render('memoryExtract', {
        sessionId: ctx.sourceSession.id,
        files: await api.transcripts.describe(ctx.sourceSession.id, 'files'),
        focus: await api.prompts.focus(ctx.prompt, ctx.session, 'memory-extract', ctx.promptProvenance),
      }, ctx.session, 'memory-extract', ctx.promptProvenance)
    },
  }],
} satisfies PluginDefinition)
