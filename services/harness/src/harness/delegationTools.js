// Shared definitions for MCP discovery and provider prompt versions.
const childProperties = { sessionId: { type: 'string' }, runId: { type: 'string' } }
const childSchema = { type: 'object', properties: childProperties, required: ['sessionId', 'runId'], additionalProperties: false }
const tools = [
  { name: 'spawn', description: 'Delegate a bounded task with context, scope, expected output, and stopping point. Assign separate files for parallel edits. Provider selection is automatic; mode defaults to the parent. At most four active children. The harness enforces depth limits. Continue independent work or end your turn; results resume you automatically.', inputSchema: {
    type: 'object', properties: { task: { type: 'string' }, retryKey: { type: 'string', minLength: 1, maxLength: 256, description: 'Stable task key; reuse only when retrying the same task.' },
      dontReturn: { type: 'boolean', description: 'Default false. True suppresses automatic results and parent resumption. Use only when neither results nor completion notice are needed; status/wait remain available.' },
      model: { type: 'string', description: 'Default inherit preserves parent provider, model, and settings. Use grok-4.7 only for fact-finding; inherit for all judgment and implementation, including read-only review.' }, mode: { type: 'string', enum: ['agent', 'plan', 'ask'] } },
    required: ['task', 'retryKey'], additionalProperties: false,
  } },
  { name: 'status', description: 'Read child state, pending user questions, and errors, including earlier turns. Do not poll; results arrive automatically unless dontReturn is true.', inputSchema: childSchema },
  { name: 'wait', description: 'Read the current child result immediately. Does not wait. Do not poll; continue independent work or end your turn while the child runs.', inputSchema: {
    ...childSchema, properties: { ...childProperties, seconds: { type: 'number', minimum: 0, maximum: 20, description: 'Compatibility argument only; does not delay the response.' } },
  } },
  { name: 'stop', description: 'Cancel a child owned by this session, including one started in an earlier turn.', inputSchema: childSchema },
]

module.exports = { tools }
