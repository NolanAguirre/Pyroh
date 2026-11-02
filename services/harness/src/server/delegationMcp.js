const express = require('express')
const delegation = require('../harness/delegation')

const childProperties = { sessionId: { type: 'string' }, runId: { type: 'string' } }
const childSchema = { type: 'object', properties: childProperties, required: ['sessionId', 'runId'], additionalProperties: false }
const tools = [
  { name: 'spawn', description: 'Delegate a bounded question or task in the shared project directory when a concise answer saves parent context. Keep lookups local when you need the source directly for your next action; weigh context savings and latency, not file count. State the question, relevant context, scope, expected output, and stopping point. Give agents separate work and separate file ownership. Request exact-symbol searches first, relevant sections only, and a short answer with paths, brief evidence, and unresolved gaps, not file dumps. Do not repeat delegated searches; use findings directly and read more only for a specific gap or edit context. Choose a model; the provider is selected automatically. Use grok-4.7 only for exploration and fact-finding; return evidence and gaps. Use inherit for decisions, recommendations, planning, design, code review, and implementation, even when read-only. Keep decisions with the parent or an inherit child. Omitting model or choosing inherit preserves the parent provider, model, and settings (for example, Codex GPT-6 Astra stays on Codex). Defaults to the parent base mode. At most four active children; no nested delegation. Retry the same task with the same retryKey. After spawning, continue useful independent work. Never sleep, use timers, poll, or hold your turn open to wait for a child. When no independent work remains, end your turn with a brief account of completed and pending work, even if the overall task needs the child result. Children keep working; completed results automatically append a new message and resume the parent so it can continue.', inputSchema: {
    type: 'object', properties: { task: { type: 'string' }, retryKey: { type: 'string', minLength: 1, maxLength: 256 },
      model: { type: 'string', description: 'Model ID, or inherit (default) to preserve the parent provider, model, and settings. Use grok-4.7 only for exploration and fact-finding; use inherit for decisions, recommendations, planning, design, code review, and implementation, including read-only judgment.' }, mode: { type: 'string', enum: ['agent', 'plan', 'ask'] } },
    required: ['task', 'retryKey'], additionalProperties: false,
  } },
  { name: 'status', description: 'Get a child state, pending user questions, and errors, including children from earlier turns in this session. Use for a specific information need, never to poll for completion. If only child work remains, end your turn; completed results automatically resume the parent.', inputSchema: childSchema },
  { name: 'wait', description: 'Read the current child result immediately; this tool does not wait. The seconds argument does not delay the response. Never loop on this tool or sleep to wait for a child. If the child is still running, continue useful independent work or end your turn with a brief pending-work update. Completed results automatically append a new message and resume the parent.', inputSchema: {
    ...childSchema, properties: { ...childProperties, seconds: { type: 'number', minimum: 0, maximum: 20, description: 'Compatibility argument only; does not delay the response.' } },
  } },
  { name: 'stop', description: 'Cancel a child owned by this session, including one started in an earlier turn.', inputSchema: childSchema },
]
const router = express.Router()
router.use('/:token', (req, res, next) => {
  try { req.delegation = delegation.authenticate(req.params.token); next() }
  catch (err) { res.status(403).json({ error: err.message }) }
})
router.get('/:token', (_req, res) => res.status(405).end())
router.delete('/:token', (_req, res) => res.status(405).end())
router.post('/:token', async (req, res) => {
  const message = req.body
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return res.status(400).json({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32600, message: 'Invalid request' } })
  }
  if (message.id == null) return res.status(202).end()
  const reply = (result) => res.json({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize') {
    const versions = ['2025-06-18', '2025-03-26', '2024-11-05']
    return reply({ protocolVersion: versions.includes(message.params?.protocolVersion) ? message.params.protocolVersion : versions[0],
      capabilities: { tools: {} }, serverInfo: { name: 'harness-agents', version: '1.0.0' } })
  }
  if (message.method === 'ping') return reply({})
  if (message.method === 'tools/list') return reply({ tools })
  if (message.method !== 'tools/call') return res.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  try {
    const { name, arguments: args = {} } = message.params || {}
    const tool = tools.find(item => item.name === name)
    if (!tool) throw new Error('Unknown tool')
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
    for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new Error(`Unknown argument: ${key}`)
    for (const key of tool.inputSchema.required) if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} is required`)
    for (const [key, value] of Object.entries(args)) {
      const schema = tool.inputSchema.properties[key]
      if (typeof value !== schema.type || (schema.enum && !schema.enum.includes(value))) throw new Error(`Invalid ${key}`)
    }
    const result = await delegation[name](req.delegation, args)
    return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] })
  } catch (err) {
    return reply({ isError: true, content: [{ type: 'text', text: err.message }] })
  }
})
module.exports = router
