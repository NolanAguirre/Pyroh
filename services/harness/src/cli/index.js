const fs = require('fs')
const config = require('../config')
const Harness = require('../harness/Harness')
const sessionStore = require('../store/sessionStore')
const { createDriver, listProviders } = require('../agents/driver')
const { resolveWorkDir } = require('../store/workDir')
const { snapshotIfGitRepo } = require('../store/gitSnapshot')
const workspaceStore = require('../store/workspaceStore')
const tokenWaste = require('../modes/tokenWaste')
const memoryExtract = require('../modes/memoryExtract')
const newChat = require('../modes/newChat')
const registry = require('../registry')

// Kinds this command runs in the foreground; others go through Harness.run.
const FOREGROUND_KINDS = ['turn', 'token-waste', 'memory', 'new-chat']

// Modes that run in a new sibling session built from the source session.
const SIBLING_MODES = {
  [tokenWaste.MODE]: (sessionId, flags) => Harness.createTokenWasteSession(sessionId, { prompt: flags.prompt }),
  [memoryExtract.MODE]: (sessionId, flags) => Harness.createMemorySession(sessionId, { prompt: flags.prompt }),
}

const DEFAULT_RESUME_PROMPT = 'Continue where you left off'

const USAGE = `harness <command> [options]

Commands:
  workspace create [--name n] [--cwd dir]                 Create a workspace
  workspace list                                          List workspaces
  workspace show <wid>                                    Show a workspace
  workspace modes <wid>                                   List the workspace's allowed modes
  session create --workspace <wid> [--provider p] [--model m]
                                                          Create a session in a workspace
  plan <sid> --prompt <text> [--detach]                   Run a plan-mode turn
  ask <sid> --prompt <text> [--detach]                    Ask a question without changing code
  run <sid> --prompt <text> [--mode agent|plan|ask|token-waste|memory-extract|new-chat|<plugin-id>] [--detach]
                                                          Run a turn (prompt optional for token-waste/memory-extract/new-chat)
                                                          Plugin modes always run detached
  token-waste <sid> [--prompt <focus>] [--detach]          Spawn a new session to analyze token savings
  memory <sid> [--prompt <focus>] [--detach]               Spawn a new session to extract memories via mcp-memory
  runs [--mode mode]                                      List indexed runs, metrics, and transcript paths
  token-waste-runs                                        Alias for runs --mode token-waste
  new-chat <sid> [--prompt <focus>] [--provider p] [--model m] [--target-mode agent|ask|plan] [--detach]
                                                          Summarize and continue in a new session
  decompose <sid> --prompt <text> [--plan-file path] [--detach]
                                                          Decompose a top-level plan
  resume <sid> [--prompt <text>] [--detach]               Resume a paused session
  pause <sid>                                              Cancel in-flight run, mark paused
  stop <sid>                                               Cancel in-flight run, mark stopped
  answer <sid> <qid> <json>                                Answer a pending question
  status <sid>                                             Show session status
  list [--workspace wid]                                   List sessions
  reindex                                                  Rebuild the SQLite session index from session.json files
  models [--provider p]                                    List provider models
  tool-stats [--since t] [--until t] [--bucket hour|day|week] [--by workspace|provider|model|session]
             [--workspace wid] [--session sid] [--provider p] [--tool name] [--top n] [--json]
                                                          Tool-call analytics (t: 2026-09-01 or 30m|24h|7d|4w)

Codex session options (with --provider codex):
  --reasoning-effort <effort>    Choose an effort returned by models --provider codex
  --sandbox <mode>               read-only | workspace-write | danger-full-access (default)
  --approval-policy <policy>     on-request | never (default)
  --web-search <mode>            disabled | cached (default) | live

Codex runtime: install the Codex CLI and run codex login before use.
  HARNESS_CODEX_BIN              Executable path (default: PATH, then Linux desktop bundle)
  HARNESS_CODEX_HOME             Optional persistent Codex home; otherwise use CLI state
  HARNESS_CODEX_API_KEY          Optional API key; uses write-dir/codex-api by default
                                Set HARNESS_CODEX_HOME to override that location.

Grok session options (with --provider grok):
  --reasoning-effort <effort>    low | medium | high | xhigh (per model; see models --provider grok)

Grok runtime: install the Grok CLI and run grok login before use.
  HARNESS_GROK_BIN               Executable path (default: PATH, then ~/.local/bin/grok)

Claude session options (with --provider claude):
  --reasoning-effort <effort>    low | medium | high | xhigh | max (per model; see models --provider claude)
  --permission-mode <mode>       default (ask) | acceptEdits | auto | bypassPermissions (default)

Claude runtime: uses the Claude Agent SDK. Run claude login (or set ANTHROPIC_API_KEY) before use.
  HARNESS_CLAUDE_BIN             Optional Claude Code executable (default: binary bundled with the SDK)
`

// Minimal flag parser: collects --key value pairs and bare positionals.
const parseArgs = (argv) => {
  const positionals = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i += 1
      }
    } else {
      positionals.push(token)
    }
  }
  return { positionals, flags }
}

const print = (value) => {
  if (typeof value === 'string') process.stdout.write(`${value}\n`)
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const fail = (msg, code = 2) => {
  process.stderr.write(`${msg}\n`)
  process.exit(code)
}

// plan/run/resume share this driver. In foreground it runs the daemon inline;
// with --detach it re-spawns itself detached and prints the run id.
const handleTurn = async (action, sessionId, flags) => {
  if (!sessionId) return fail(`${action}: missing <sid>`)
  const current = flags['run-id'] ? null : sessionStore.loadSession(sessionId, config.writeDir)
  if (current && action !== 'plan' && !flags.mode) flags = { ...flags, mode: Harness.replyMode(current) }
  if (action === 'run' && flags.mode && !flags['run-id'] && !FOREGROUND_KINDS.includes(registry.builtinMode(flags.mode)?.kind)) {
    try {
      return print(await Harness.run(sessionId, {
        mode: flags.mode, prompt: flags.prompt, provider: flags.provider, model: flags.model, targetMode: flags['target-mode'],
      }))
    } catch (err) {
      return fail(`${action}: ${err && err.message}`)
    }
  }
  if (!flags['run-id']) {
    const source = sessionStore.loadSession(sessionId, config.writeDir)
    try {
      if (source) registry.requireMode(registry.sessionWorkspace(source), action === 'plan' ? 'plan' : flags.mode || 'agent', { provider: source.provider })
    } catch (err) {
      return fail(`${action}: ${err && err.message}`)
    }
  }
  const createSibling = SIBLING_MODES[flags.mode]
  if (createSibling && current && !Harness.repliesInPlace(current, registry.builtinMode(flags.mode))) {
    let sibling
    try {
      sibling = createSibling(sessionId, flags)
    } catch (err) {
      return fail(`${action}: ${err && err.message}`)
    }
    sessionId = sibling.session.id
    flags = { ...flags, prompt: sibling.prompt }
    print({ sessionId, sourceSessionId: sibling.session.sourceSessionId })
  }
  const lock = require('../store/sessionLock').acquire(sessionId, config.writeDir)
  sessionStore.recoverSession(sessionId, config.writeDir, { excludeRunId: flags['run-id'] })
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) return fail(`${action}: session not found: ${sessionId}`)

  let run
  if (flags['run-id']) {
    run = sessionStore.loadRun(sessionId, flags['run-id'], config.writeDir)
    if (!run) return fail(`${action}: run not found: ${flags['run-id']}`)
  } else {
    const mode = action === 'plan' ? 'plan' : flags.mode || 'agent'
    let prompt = flags.prompt
    let handoff
    if (mode === newChat.MODE) {
      prompt = newChat.buildPrompt(prompt)
      try {
        handoff = Harness.resolveNewChatTarget(session, {
          provider: flags.provider,
          model: flags.model,
          mode: flags['target-mode'],
        })
      } catch (err) {
        return fail(`${action}: ${err && err.message}`)
      }
    }
    if (action === 'resume' && !prompt) prompt = DEFAULT_RESUME_PROMPT
    if (!prompt) return fail(`${action}: --prompt is required`)
    run = sessionStore.createRun(sessionId, { mode, prompt, handoff })
    if (!session.mode && registry.builtinMode(mode)?.kind === 'turn') sessionStore.updateSession(sessionId, { mode }, config.writeDir)
  }

  if (flags.detach) {
    const proc = require('../harness/process')
    proc.spawnHarness([action, sessionId, '--run-id', run.id], lock.spawnOptions())
    print(run.id)
    process.exit(0)
  }

  // Attach before the snapshot, which can fail before the provider starts.
  const { runDaemon, attachLog } = require('../harness/daemon')
  attachLog(sessionId, config.writeDir)
  try {
    const entry = run.plugin ? null : registry.builtinMode(run.mode)
    if (run.plugin ? run.plugin.base !== 'ask' : entry ? entry.snapshot : true) {
      const cwd = workspaceStore.resolveSessionCwd(session, config.writeDir)
      const snap = snapshotIfGitRepo(cwd, {
        message: `harness: snapshot before ${action} ${run.id}`,
      })
      if (snap.committed) {
        process.stderr.write(`git snapshot ${snap.hash} in ${cwd}\n`)
      }
    }
  } catch (err) {
    const message = `${action}: git snapshot failed: ${err && err.message}`
    require('../store/eventLog').append(sessionId, { type: 'error', runId: run.id, message }, config.writeDir)
    sessionStore.updateRun(sessionId, run.id, { status: 'error', error: message, endedAt: Date.now() }, config.writeDir)
    sessionStore.updateSession(sessionId, {
      status: 'error', lastError: { message, runId: run.id, at: Date.now() },
    }, config.writeDir)
    return fail(message, 1)
  }

  await runDaemon({
    sessionId,
    runId: run.id,
    action,
    mode: run.mode,
  })
}

const handleDecompose = async (sessionId, flags) => {
  if (!sessionId) return fail('decompose: missing <sid>')
  const lock = require('../store/sessionLock').acquire(sessionId, config.writeDir)
  sessionStore.recoverSession(sessionId, config.writeDir)
  const session = sessionStore.loadSession(sessionId, config.writeDir)
  if (!session) return fail(`decompose: session not found: ${sessionId}`)

  const resume = Boolean(flags.resume)
  let prompt = flags.prompt
  if (flags['plan-file']) {
    try {
      prompt = fs.readFileSync(flags['plan-file'], 'utf8')
    } catch (err) {
      return fail(`decompose: could not read --plan-file: ${err && err.message}`)
    }
  }
  if (!resume && !prompt) prompt = sessionStore.readSourcePlan(sessionId, config.writeDir)
  if (!resume && !prompt) return fail('decompose: --prompt or --plan-file is required')

  if (!resume) {
    if (flags.prompt || flags['plan-file']) {
      sessionStore.writeSourcePlan(sessionId, prompt, config.writeDir)
    }
    sessionStore.updateSession(
      sessionId,
      { mode: 'decompose', currentPhase: null, currentStep: null, totalPhases: null },
      config.writeDir,
    )
  }

  if (flags.detach) {
    const proc = require('../harness/process')
    const args = ['decompose', sessionId]
    if (resume) args.push('--resume')
    proc.spawnHarness(args, lock.spawnOptions())
    print({ sessionId, mode: 'decompose', resume })
    process.exit(0)
  }

  try {
    const { runDecomposeDaemon } = require('../modes/decompose/orchestrator')
    await runDecomposeDaemon({ sessionId, resume })
  } catch (err) {
    const { errorMessage, formatError } = require('../store/formatError')
    const eventLog = require('../store/eventLog')
    const message = errorMessage(err)
    process.stderr.write(`decompose: ${formatError(err)}\n`)
    try {
      eventLog.append(sessionId, { type: 'error', message }, config.writeDir)
      sessionStore.updateSession(
        sessionId,
        { status: 'error', lastError: { message, at: Date.now() } },
        config.writeDir,
      )
    } catch {
      // session may already be gone
    }
    process.exit(1)
  }
}

const handleToolStats = async (flags) => {
  const analytics = require('../analytics/client')
  const { formatText } = require('../analytics/format')
  let summary
  try {
    summary = await analytics.toolStats(flags)
  } catch (err) {
    return fail(`tool-stats: ${err.message}`)
  }
  return print(flags.json ? summary : formatText(summary))
}

const resolveWorkspaceFlag = async (flags) => {
  const workspaceId = flags.workspace || flags.wid
  if (workspaceId) return workspaceId
  const workspaces = await Harness.listWorkspaces()
  if (workspaces.length === 1) return workspaces[0].id
  return null
}

const main = async (argv) => {
  const [command, ...rest] = argv
  const { positionals, flags } = parseArgs(rest)
  workspaceStore.ensureLayout(config.writeDir)

  switch (command) {
    case 'workspace': {
      const sub = positionals[0]
      if (sub === 'list') return print(await Harness.listWorkspaces())
      if (sub === 'show') {
        const id = positionals[1]
        if (!id) return fail('usage: harness workspace show <wid>')
        const workspace = await Harness.getWorkspace(id)
        if (!workspace) return fail(`workspace not found: ${id}`)
        return print(workspace)
      }
      if (sub === 'modes') {
        const id = positionals[1]
        if (!id) return fail('usage: harness workspace modes <wid>')
        const workspace = await Harness.getWorkspace(id)
        if (!workspace) return fail(`workspace not found: ${id}`)
        return print(registry.listAllowed(workspace).modes)
      }
      if (sub !== 'create') {
        return fail('usage: harness workspace create [--name n] [--cwd dir]')
      }
      let cwd
      try {
        cwd = resolveWorkDir(flags.cwd)
      } catch (err) {
        return fail(`workspace create: ${err.message}`)
      }
      return print(Harness.createWorkspace({ name: flags.name || null, cwd }))
    }
    case 'session': {
      const sub = positionals[0]
      if (sub !== 'create') {
        return fail('usage: harness session create --workspace <wid> [--provider p] [--model m]')
      }
      const workspaceId = await resolveWorkspaceFlag(flags)
      if (!workspaceId) {
        return fail('session create: --workspace is required (or create exactly one workspace)')
      }
      try {
        const session = Harness.createSession({
          workspaceId,
          provider: flags.provider || 'cursor',
          model: flags.model || null,
          ...(flags.provider === 'codex' ? { codex: {
            reasoningEffort: flags['reasoning-effort'], sandbox: flags.sandbox,
            approvalPolicy: flags['approval-policy'], webSearch: flags['web-search'],
          } } : {}),
          ...(flags.provider === 'grok' ? { grok: { reasoningEffort: flags['reasoning-effort'] } } : {}),
          ...(flags.provider === 'claude' ? { claude: {
            reasoningEffort: flags['reasoning-effort'], permissionMode: flags['permission-mode'],
          } } : {}),
        })
        return print(session)
      } catch (err) {
        return fail(`session create: ${err && err.message}`)
      }
    }
    case 'plan':
      return handleTurn('plan', positionals[0], flags)
    case 'run':
      return handleTurn('run', positionals[0], flags)
    case 'ask':
      return handleTurn('run', positionals[0], { ...flags, mode: 'ask' })
    case 'token-waste':
      return handleTurn('run', positionals[0], { ...flags, mode: tokenWaste.MODE })
    case 'memory':
      return handleTurn('run', positionals[0], { ...flags, mode: memoryExtract.MODE })
    case 'token-waste-runs':
      return print(require('../store/runIndexStore').listRuns(config.writeDir, { mode: tokenWaste.MODE }))
    case 'runs':
      return print(require('../store/runIndexStore').listRuns(config.writeDir, { mode: flags.mode }))
    case 'new-chat':
      return handleTurn('run', positionals[0], { ...flags, mode: newChat.MODE })
    case 'decompose':
      return handleDecompose(positionals[0], flags)
    case 'resume': {
      const sid = positionals[0]
      if (!sid) return fail('resume: missing <sid>')
      const session = sessionStore.loadSession(sid, config.writeDir)
      if (
        session &&
        session.mode === 'decompose' &&
        session.currentStep &&
        session.currentStep !== 'done'
      ) {
        return handleDecompose(sid, { ...flags, resume: true })
      }
      return handleTurn('resume', sid, flags)
    }
    case 'pause': {
      if (!positionals[0]) return fail('usage: harness pause <sid>')
      return print(Harness.pause(positionals[0]))
    }
    case 'stop': {
      if (!positionals[0]) return fail('usage: harness stop <sid>')
      return print(Harness.stop(positionals[0]))
    }
    case 'answer': {
      const [sid, qid, raw] = positionals
      if (!sid || !qid || raw === undefined) return fail('usage: harness answer <sid> <qid> <json>')
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        value = raw
      }
      return print(Harness.answer(sid, qid, value))
    }
    case 'status': {
      if (!positionals[0]) return fail('usage: harness status <sid>')
      const s = await Harness.status(positionals[0])
      if (!s) return fail(`session not found: ${positionals[0]}`)
      return print(s)
    }
    case 'list':
      return print(await Harness.list(flags.workspace || flags.wid))
    case 'reindex':
      return print(await require('../store/sessionIndex').reconcile(config.writeDir, { force: true }))
    case 'models': {
      const provider = flags.provider || 'cursor'
      let driver
      let modelError
      try {
        driver = createDriver({ provider })
        const models = await driver.listModels()
        return print(models)
      } catch (err) {
        modelError = err
      } finally {
        await driver?.close()
      }
      if (modelError) return fail(`models: ${modelError.message}`, 1)
    }
    case 'providers':
      return print(listProviders())
    case 'tool-stats':
      return handleToolStats(flags)
    case 'help':
    case undefined:
      return print(USAGE)
    default:
      return fail(`unknown command: ${command}\n\n${USAGE}`)
  }
}

module.exports = { main, parseArgs }
