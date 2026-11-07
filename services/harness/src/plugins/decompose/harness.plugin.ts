import { definePlugin, type PluginDefinition } from '../../sdk'

const parsePhaseCount = (text: string): { count: number } => {
  let raw = String(text || '').trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('phase count: no JSON object in model output')
  }
  raw = raw.slice(start, end + 1)
  let data: { count?: unknown }
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`phase count: invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof data.count !== 'number' || !Number.isFinite(data.count) || data.count < 1) {
    throw new Error('phase count: count must be a positive number')
  }
  return { count: Math.floor(data.count) }
}

export default definePlugin({
  manifest: { id: 'decompose', version: '1.0.0', sdkVersion: 1 },
  getModes: () => [{
    id: 'decompose',
    label: 'Decompose',
    hint: 'Recursively decomposes high-level goals into phased steps.',
    base: 'plan',
    terse: false,
    delegationEligible: false,
    autoName: false,
    snapshot: false,
    savePlan: false,
    steerable: false,
    sendLabel: 'Decompose',
    placeholder: 'Paste a high-level plan to decompose into sub-phases…',
    pipeline: {
      once: [{
        id: 'count',
        agentMode: 'ask',
        promptKey: 'countPhases',
        outputSchema: {
          type: 'object',
          properties: { count: { type: 'integer', minimum: 1 } },
          required: ['count'],
          additionalProperties: false,
        },
        parse: parsePhaseCount,
        write: 'count.json',
      }],
      eachPhase: [{
        id: 'plan',
        agentMode: 'plan',
        promptKey: 'planPhase',
        write: 'plan.md',
      }, {
        id: 'execute',
        agentMode: 'agent',
        promptKey: 'executePhase',
      }],
    },
  }],
} satisfies PluginDefinition)
