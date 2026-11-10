export type CoreMode = 'agent' | 'ask' | 'plan'
export type MaybePromise<T> = T | Promise<T>
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface PromptSection {
  kind: 'system' | 'user' | 'rewritten' | 'context'
  label: string
  text: string
}
export interface PromptProvenance {
  sections: PromptSection[]
  text?: string
  originalText?: string
  rewrittenText?: string
  messageType?: 'user' | 'agent'
  userItemId?: string
}
export interface PromptDocument extends PromptProvenance { text: string }
export interface ImageAttachment {
  id: string
  sessionId: string
  name?: string
  mimeType?: string
  size?: number
}
export interface RunOptions {
  mode?: string | null
  prompt?: string | null
  images?: ImageAttachment[]
  provider?: string | null
  model?: string | null
  targetMode?: string | null
  runAfterSessionId?: string | null
  forkRetryKey?: string | null
  promptProvenance?: PromptProvenance | null
}
export interface Workspace {
  id: string
  cwd: string
  name?: string
  [key: string]: unknown
}
export interface Session {
  id: string
  cwd: string
  workspaceId?: string | null
  name?: string | null
  provider: string
  model?: string | null
  mode?: string | null
  [key: string]: unknown
}
// Store and launch records contain additional provider-specific fields.
export interface RunHandle {
  id?: string
  sessionId: string
  mode: string
  daemonPid?: number | null
  runId?: string | null
  status?: string
  queued?: boolean
  resume?: boolean
  [key: string]: unknown
}
export interface RunResult {
  id?: string
  runId?: string | null
  sessionId?: string
  mode?: string
  status?: string
  text?: string
  response?: string
  output?: string
  result?: string | null
  error?: string | null
  pid?: number | null
  startedAt?: number
  endedAt?: number | null
  durationMs?: number
  [key: string]: unknown
}
export interface SessionRun { session: Session; run: RunHandle }
export interface PluginContext {
  workspace: Workspace
  session: Session
  sourceSession: Session
  runId: string | null
  prompt: string
  promptProvenance?: PromptProvenance | null
  options: RunOptions
}
export interface PipelineStep {
  id: string
  label?: string
  agentMode: CoreMode
  promptKey: string
  outputSchema?: Record<string, JsonValue>
  parse?: (text: string) => { count: number }
  write?: string
  requiresPlan?: boolean
}
export interface PhasePipeline { once: PipelineStep[]; eachPhase: PipelineStep[] }
export interface ModeBehavior {
  terse?: boolean
  delegationEligible?: boolean
  promptOptional?: boolean
  newSession?: boolean
  autoName?: boolean
  snapshot?: boolean
  savePlan?: boolean
  steerable?: boolean
  tools?: string[]
  instructions?: string | null | ((ctx: PluginContext, api: HarnessApi) => MaybePromise<string | null>)
}
export interface PluginMode extends ModeBehavior {
  id: string
  interaction?: 'turn' | 'continuation' | 'fork'
  base?: CoreMode
  label?: string
  hint?: string
  sessionName?: string | null
  sendLabel?: string
  placeholder?: string
  buildPrompt?: ((ctx: PluginContext, api: HarnessApi) => MaybePromise<string | PromptDocument>) | null
  onComplete?: ((ctx: PluginContext, result: RunResult, api: HarnessApi) => MaybePromise<void | { continuation: SessionRun }>) | null
  launch?: ((ctx: PluginContext, api: HarnessApi) => MaybePromise<RunHandle>) | null
  pipeline?: PhasePipeline
}
export interface PluginManifest { id: string; version: string; sdkVersion: 1 }
export type RegistryKind = 'mode' | 'tool' | 'panel'
export type Effect = 'allow' | 'deny'
export interface Decision {
  effect: Effect
  by: string
  reason: string
  scope?: string
  source?: string
  file?: string | null
  rule?: string
  overridden?: Decision
}
export interface PolicyContext {
  kind: RegistryKind
  id: string
  workspace: Workspace | null
  mode?: string
  provider?: string
  decision: Decision
}
export interface PromptContext {
  workspace?: Workspace | null
  workspaceId?: string | null
  cwd?: string
  provider?: string
  model?: string | null
  mode?: string | null
  messageType?: 'user' | 'agent'
  first?: boolean
  [key: string]: unknown
}
export interface PromptTemplate {
  template?: string
  name?: string
  firstMessage?: boolean
  messageTypes?: ('user' | 'agent')[]
}
export interface PromptTrigger {
  patterns?: RegExp[]
  excludePatterns?: RegExp[]
  scope?: 'first' | 'message'
}
export interface PromptOverlay {
  // An include list replaces the inherited selection. Exclude wins within a layer.
  include?: string[]
  exclude?: string[]
  templates?: Record<string, string | PromptTemplate>
  triggers?: Record<string, PromptTrigger>
  // Pure transform after built-in text rewrites, before instructions are prepended.
  // Called for both draft previews and sends; preserve the document's provenance.
  rewritePrompt?: (prompt: PromptDocument, context: PromptContext) => MaybePromise<PromptDocument>
}
export interface PluginDefinition {
  manifest?: PluginManifest
  getModes?: (api: HarnessApi) => PluginMode[]
  prompts?: PromptOverlay
  getPrompts?: (context: PromptContext) => PromptOverlay | null | undefined
  policy?: (ctx: PolicyContext) => { effect: Effect; reason?: string } | null | void
}
export interface SessionTarget { provider: string; model: string | null; mode: string }
export interface SessionOptions {
  provider?: string | null
  model?: string | null
  mode?: string | null
  name?: string | null
}
export interface RunStatus {
  session?: Session
  run?: RunResult | null
  status?: string
  [key: string]: unknown
}
export interface HarnessApi {
  workspace: Workspace
  run(sessionId: string, options?: RunOptions): MaybePromise<RunHandle>
  sessions: {
    create(options?: SessionOptions): Session
    inspect(sessionId: string): Session
    resolveTarget(sourceSessionId: string, options?: SessionOptions): SessionTarget
    continue(sourceSessionId: string, prompt: string, target?: SessionOptions, images?: ImageAttachment[]): MaybePromise<SessionRun>
    fork(sourceSessionId: string, options?: Pick<RunOptions, 'prompt' | 'forkRetryKey' | 'promptProvenance' | 'images'>): MaybePromise<RunHandle>
  }
  prompts: {
    terse: string
    ask: string
    render(id: string, vars: Record<string, unknown>, session: Session, mode?: string, metadata?: PromptProvenance | null): PromptDocument
    focus(text: string, session: Session, mode?: string, metadata?: PromptProvenance | null): PromptDocument | string
    context(session: Session, mode?: string): Record<string, unknown>
  }
  transcripts: { describe(sessionId: string, format: 'directories' | 'files'): string }
  capabilities: { memory: boolean }
  runs: {
    inspect(sessionId: string, runId: string): RunResult
    await(sessionId: string, runId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<RunResult>
    cancel(sessionId: string, runId: string): MaybePromise<{ signalled: boolean; pid: number | null }>
  }
  createSession(options?: SessionOptions): Session
  status(sessionId: string): MaybePromise<RunStatus>
  transcriptDirs(sessionId: string): string[]
  log(message: string): void
}
export interface SavedModeDescriptor extends Omit<ModeBehavior, 'instructions'> {
  id: string
  sourceSessionId?: string
  base: CoreMode
  kind?: 'plugin' | 'workflow'
  manifest?: PluginManifest
  instructions?: string | null
  options?: RunOptions
}
