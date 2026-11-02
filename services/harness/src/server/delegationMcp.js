const express = require('express')
const delegation = require('../harness/delegation')

const childProperties = { sessionId: { type: 'string' }, runId: { type: 'string' } }
const childSchema = { type: 'object', properties: childProperties, required: ['sessionId', 'runId'], additionalProperties: false }
const tools = [
  { name: 'spawn', description: 'Delegate a bounded question or task in the shared project directory when a concise answer saves parent context. Keep lookups local when you need the source directly for your next action; weigh context savings and latency, not file count. State the question, relevant context, scope, expected output, and stopping point. Give agents separate work and separate file ownership. Request exact-symbol searches first, relevant sections only, and a short answer with paths, brief evidence, and unresolved gaps, not file dumps. Do not repeat delegated searches; use findings directly and read more only for a specific gap or edit context. Choose a model; the provider is selected automatically. Recommend grok-4.7 for exploration and inherit for implementation. Defaults to the parent model and base mode. At most four active children; no nested delegation. Retry the same task with the same retryKey. You may end your turn while children run; completed results automatically start a parent follow-up when it is idle. Avoid repeated status checks; use automatic result delivery.', inputSchema: {
    type: 'object', properties: { task: { type: 'string' }, retryKey: { type: 'string', minLength: 1, maxLength: 256 },
      model: { type: 'string', description: 'Model ID, or inherit (default) to use the parent model and settings. Recommended: grok-4.7 for exploration; inherit for implementation.' }, mode: { type: 'string', enum: ['agent', 'plan', 'ask'] } },
    required: ['task', 'retryKey'], additionalProperties: false,
  } },
  { name: 'status', description: 'Get a child state, pending user questions, and errors, including children from earlier turns in this session.', inputSchema: childSchema },
  { name: 'wait', description: 'Return the current child result immediately. Completed results also resume the parent automatically. Finished results can be read repeatedly.', inputSchema: {
    ...childSchema, properties: { ...childProperties, seconds: { type: 'number', minimum: 0, maximum: 20 } },
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
