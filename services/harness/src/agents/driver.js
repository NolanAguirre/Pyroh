// Generic, provider-agnostic agent driver interface.
//
// A driver wraps a single conversation with an underlying agent provider
// (Cursor SDK, Claude, ...). The daemon owns exactly one driver per process.
//
// Driver shape:
//   create({ model, cwd, mode, tools }) -> Promise<void>
//     Start a fresh agent. `tools` is the SDK built-in tool list (`[]` = text-only).
//     Harness tools go to createDriver({ tools: { list, askUser?, mcpServers? } }):
//     `list` is the registry tool ids allowed this turn, and a tool's callback is
//     only set when it is allowed. Drivers deliver each tool through their own
//     mechanism (custom tool, dynamic tool, permission flow); the registry does
//     the gating. `mcpServers` is [{ name, url }] of streamable HTTP MCP servers
//     each driver converts to its provider's config and auto-approves.
//   resume(providerAgentId, { model, cwd, mode, tools }) -> Promise<void>
//     Rehydrate an existing agent by its provider-specific id and restore settings.
//   fork(sourceProviderAgentId, { model, cwd, mode, tools, childProviderAgentId? })
//     -> Promise<string>
//     On a fresh driver, persist a native child before sending any prompt; return
//     its id and expose it through providerAgentId(). Pass the source settings
//     and construct the driver with the same provider options and harness tools.
//     Current native materialization APIs allocate their own ids and reject
//     childProviderAgentId with PROVIDER_FORK_ID_UNSUPPORTED. Unsupported providers
//     throw PROVIDER_FORK_UNSUPPORTED. No replay or parent-resume fallback.
//     Persist fork intent before calling and the returned id before send(). An
//     interrupted call (including a process crash) must not be blindly retried:
//     PROVIDER_FORK_OUTCOME_UNKNOWN has retryable=false and may have left a child.
//     Resume a known child id on recovery. Start child usage accounting at zero;
//     inherited provider totals are context/baseline, not new billable usage.
//   send(prompt, { mode, onEvent, outputSchema?, terse? }) -> Promise<{ cancel, wait }>
//     Kick off a run. `onEvent(event)` receives normalized events as they stream.
//     `cancel()` cancels the in-flight run. `wait()` resolves the terminal result:
//       { status, result, usage, durationMs, error }
//     `mode` is one of modes.AGENT_MODES. Each driver maps it to the provider's
//     native mode or emulates it through the provider mode registry. Ask
//     restrictions depend on the provider; Codex permits shell reads by prompt.
//     `terse` prefixes modes.tersePrompt(). The caller sets it on the first prompt
//     of an execute, ask, plan, or token-waste session.
//   listModels() -> Promise<Array<{ id, displayName? }>>
//   providerAgentId() -> string | null
//   close() -> Promise<void>
//
// Normalized event union (the `type` field):
//   text      { type, text, runId? }
//   thinking  { type, text, runId? }
//   tool_call { type, name, input?, status?, runId? }
//   question  { type, id, question, options?, allowMultiple?, runId? }
//   usage     { type, usage, runId? }
//   context   { type, context: { usedTokens, maxTokens?, status? }, runId? }
//   status    { type, status, runId? }
//   result    { type, status, result?, usage?, durationMs?, runId? }
//   error     { type, message, runId? }
//   plan      { type, itemId, plan, explanation?, runId? }
//   diff      { type, itemId, diff, runId? }
// Text/thinking events may carry itemId + delta or replace. Tool events may
// carry itemId, output/outputDelta, exitCode, and error. Consumers merge items
// within a run; completed snapshots replace streamed text/output.

const providers = {
  cursor: () => require('./providers/cursor'),
  claude: () => require('./providers/claude'),
  codex: () => require('./providers/codex'),
  grok: () => require('./providers/grok'),
}

const listProviders = () => Object.keys(providers)

const MEMORY_SERVER_NAME = 'harness_memory'
const DEVID_SERVER_NAME = 'mcpdevid'

const createDriver = ({ provider, ...opts }) => {
  const loader = providers[provider]
  if (!loader) throw new Error(`unknown provider: ${provider}`)
  const mod = loader()
  return mod.createDriver(opts)
}

module.exports = { createDriver, listProviders, MEMORY_SERVER_NAME, DEVID_SERVER_NAME }
