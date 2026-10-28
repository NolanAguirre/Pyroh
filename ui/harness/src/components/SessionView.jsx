import { useEffect, useState } from 'react'
import { Badge, Button, DevScope, DropdownTypeahead, DropdownTypeaheadMenu, DropdownTypeaheadTrigger, FolderIcon, Popup, ProgressBar, Tabs, TabList, Tab, TabPanel, useSpeechRecognition } from 'component-library'
import useSessionEvents from '../useSessionEvents'
import api from '../api'
import Transcript from './Transcript'
import NewSessionForm from './NewSessionForm'
import QuestionCard from './QuestionCard'
import MetricsPanel from './MetricsPanel'
import LogFold from './LogFold'

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  error: 'danger',
}

const ICONS = {
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  resume: 'M5 3.5v9l7-4.5z',
  stop: 'M4.5 4.5h7v7h-7z',
  panel: 'M2.5 3h11v10h-11zM9.5 3v10',
  mic: 'M6 2.5h4v6.5h-4zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M5.5 14h5',
}

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

// Modes come from the registry. These DevScope ids belong to built-in mode
// buttons; plugin modes share pm6t3qz.
const MODE_SCOPES = { agent: 'hr0m6j9', ask: 'k3w9a5t', plan: 'hr4n8d2', decompose: 'hr5k1w7' }
const MODE_DEV_IDS = { 'token-waste': 'q7m2z9k', 'new-chat': 'n4c8x2e' }

// Shown until the registry loads.
const FALLBACK_MODES = [{
  id: 'agent',
  label: 'Execute',
  scope: 'builtin',
  kind: 'turn',
  hint: '',
  sendLabel: 'Send',
  placeholder: 'Ask the agent to do something (⌘↵ to send)…',
}]

const DRAFTS_KEY = 'harness.composerDrafts'

const readDrafts = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || 'null')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

const writeDrafts = (drafts) => {
  try {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // ignore quota and private-mode failures
  }
}

// Plugin modes load later, so any mode id is kept until the registry says otherwise.
const isMode = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value)

const sharedPrompt = (entry, mode) => {
  if (!entry) return ''
  if (typeof entry.prompt === 'string') return entry.prompt
  const prompts = entry.prompts && typeof entry.prompts === 'object' ? entry.prompts : null
  if (!prompts) return ''
  const current = prompts[mode]
  if (typeof current === 'string' && current) return current
  return Object.values(prompts).find((text) => typeof text === 'string' && text) || ''
}

const loadComposer = (sessionId) => {
  const entry = sessionId ? readDrafts()[sessionId] : null
  const mode = entry && isMode(entry.mode) ? entry.mode : 'agent'
  return { mode, prompt: sharedPrompt(entry, mode) }
}

const saveComposer = (sessionId, mode, prompt) => {
  if (!sessionId) return
  const drafts = readDrafts()
  const text = typeof prompt === 'string' ? prompt : ''
  if (!text && mode === 'agent') delete drafts[sessionId]
  else drafts[sessionId] = { mode, prompt: text }
  writeDrafts(drafts)
}

const NewChatTarget = ({ providers, provider, model, onProvider, onModel }) => {
  const current = providers.find((item) => item.id === provider)
  const providerOptions = providers.map((item) => ({
    value: item.id,
    displayValue: item.implemented ? item.id : `${item.id} (unavailable)`,
  }))
  const listed = (current?.models || []).map((entry) => ({
    value: entry.id,
    displayValue: entry.displayName || entry.id,
  }))
  const withCurrent = model && !listed.some((option) => option.value === model)
    ? [{ value: model, displayValue: model }, ...listed]
    : listed
  const modelOptions = withCurrent.length
    ? withCurrent
    : [{ value: '', displayValue: 'default' }]

  return (
    <DevScope id="n8k3p1w" state={{ provider, model }}>
      <div className="composer__spawn">
        <DevScope id="n2v6h4q" state={{ provider }}>
          <div className="field composer__spawn-field">
            <span className="field__label">Spawn provider</span>
            <DropdownTypeahead
              defaultValue={provider}
              options={providerOptions}
              change={onProvider}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>
        <DevScope id="n7m1c5d" state={{ model }}>
          <div className="field composer__spawn-field">
            <span className="field__label">Spawn model</span>
            <DropdownTypeahead
              key={provider}
              defaultValue={model || modelOptions[0]?.value || ''}
              options={modelOptions}
              change={onModel}
            >
              <DropdownTypeaheadTrigger />
              <DropdownTypeaheadMenu />
            </DropdownTypeahead>
          </div>
        </DevScope>
        {current?.error ? <p className="hint hint--error">{current.error}</p> : null}
        {current && current.implemented === false ? (
          <p className="hint hint--warn">This provider is not implemented yet.</p>
        ) : null}
      </div>
    </DevScope>
  )
}

const ModeToggle = ({ modes, mode, onChange, disabled }) => (
  <div className="mode-toggle" role="group" aria-label="Session mode">
    {modes.map((item) => {
      const isActive = mode === item.id
      if (item.scope !== 'builtin') {
        return (
          <DevScope key={item.id} id="pm6t3qz" state={{ mode: item.id, active: isActive }}>
            <button
              type="button"
              className={`mode-toggle__btn${isActive ? ' mode-toggle__btn--active' : ''}`}
              aria-pressed={isActive}
              title={item.hint || undefined}
              onClick={() => onChange(item.id)}
              disabled={disabled}
            >
              {item.label}
            </button>
          </DevScope>
        )
      }
      if (MODE_SCOPES[item.id]) {
        return (
          <DevScope key={item.id} id={MODE_SCOPES[item.id]} state={{ active: isActive }}>
            <button
              type="button"
              className={`mode-toggle__btn${isActive ? ' mode-toggle__btn--active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onChange(item.id)}
              disabled={disabled}
            >
              {item.label}
            </button>
          </DevScope>
        )
      }
      return (
        <Button
          key={item.id}
          devId={MODE_DEV_IDS[item.id]}
          variant={isActive ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={isActive}
          onClick={() => onChange(item.id)}
          disabled={disabled}
        >
          {item.label}
        </Button>
      )
    })}
  </div>
)

const DecomposeProgress = ({ session }) => {
  if (!session || session.mode !== 'decompose') return null
  const total = session.totalPhases || 0
  const phase = session.currentPhase || 0
  const step = session.currentStep
  const done = step === 'done'
  const label = done
    ? 'Done'
    : total
      ? `Phase ${Math.max(phase, 1)} / ${total}`
      : 'Counting phases'
  const failed = session.status === 'error' || session.status === 'disconnected'
  const barStatus =
    failed ? 'failed' : session.status === 'running' || session.status === 'awaiting_input' ? 'uploading' : 'done'
  return (
    <DevScope id="hr1e4t6" state={{ phase, step, status: session.status }}>
      <div className="decompose-progress">
        <div className="decompose-progress__title">Decompose Progress</div>
        <ProgressBar
          label={label}
          value={done ? total : Math.max(phase, 0)}
          max={total || 1}
          status={barStatus}
          animated={barStatus === 'uploading'}
          showValue={Boolean(total)}
        />
        {step && step !== 'done' && <p className="hint">Current step: {step}</p>}
        {failed && session.lastError && session.lastError.message && (
          <p className="hint hint--error">{session.lastError.message}</p>
        )}
      </div>
    </DevScope>
  )
}

const SessionView = ({ devId, sessionId, initialSession, providers = [], workspaces = [], modes: registryModes, onChanged, onCreated, transcriptFontSize }) => {
  const { events, session: liveSession, runs, pendingQuestions } = useSessionEvents(sessionId)
  const session = liveSession || initialSession
  const [mode, setMode] = useState(() => loadComposer(sessionId).mode)
  const [prompt, setPromptState] = useState(() => loadComposer(sessionId).prompt)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [sideOpen, setSideOpen] = useState(false)
  const [handoffRunId, setHandoffRunId] = useState(null)
  const [spawnProvider, setSpawnProvider] = useState(session?.provider || '')
  const [spawnModel, setSpawnModel] = useState(session?.model || '')
  const setPrompt = (value) => {
    setPromptState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      return next === prev ? prev : next
    })
  }

  const speech = useSpeechRecognition({
    onFinal: (text) => setPrompt((prev) => (prev && !prev.endsWith(' ') ? `${prev} ${text.trim()}` : `${prev}${text.trim()}`)),
  })

  const changeMode = (next) => {
    if (next === mode) return
    speech.stop()
    setMode(next)
  }

  useEffect(() => {
    saveComposer(sessionId, mode, prompt)
  }, [sessionId, mode, prompt])

  const modes = registryModes?.length ? registryModes : FALLBACK_MODES
  const active = modes.find((item) => item.id === mode) || null
  const isDecompose = active?.kind === 'decompose'
  const isNewChat = active?.kind === 'new-chat'

  // A saved mode that this workspace no longer has falls back to agent.
  useEffect(() => {
    if (registryModes?.length && !registryModes.some((item) => item.id === mode)) setMode('agent')
  }, [registryModes, mode])

  const status = session?.status || 'idle'
  const isBusy = status === 'running' || status === 'awaiting_input'
  const disconnected = status === 'disconnected'
  const latestRun = runs[runs.length - 1]
  const hasFailure = Boolean(session?.lastError?.message || latestRun?.error || latestRun?.transcriptError)
  const promptRequired = !active?.promptOptional
  const spawnsSession = Boolean(active?.newSession)
  const blocksWhileBusy = !spawnsSession
  const steering = isBusy && active?.steerable !== false && !spawnsSession
  const spawnEntry = providers.find((item) => item.id === spawnProvider)
  const spawnModelId = spawnModel || spawnEntry?.models?.[0]?.id || null
  const spawnBlocked = isNewChat && Boolean(spawnEntry) && (spawnEntry.implemented === false || spawnEntry.error)
  const sendDisabled = steering
    ? !prompt.trim()
    : (blocksWhileBusy && isBusy) || (promptRequired && !prompt.trim()) || spawnBlocked

  useEffect(() => {
    if (!handoffRunId) return
    const handoff = events.find((event) => event.type === 'handoff' && event.runId === handoffRunId)
    if (!handoff) return
    setHandoffRunId(null)
    onCreated?.(handoff.session)
  }, [events, handoffRunId, onCreated])

  const refresh = () => {
    if (onChanged) onChanged()
  }

  const send = async () => {
    if (busy || sendDisabled) return
    speech.stop()
    setBusy(true)
    setActionError('')
    try {
      if (steering) await api.steer(sessionId, prompt)
      else if (isDecompose) await api.decompose(sessionId, prompt)
      else {
        const result = await api.run(sessionId, isNewChat
          ? { prompt, mode, provider: spawnProvider || session.provider, model: spawnModelId }
          : { prompt, mode })
        if (result.session) onCreated?.(result.session)
        if (isNewChat) setHandoffRunId(result.run.id)
      }
      if (!isDecompose) setPrompt('')
      refresh()
    } catch (err) {
      setActionError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const act = (fn) => async () => {
    setBusy(true)
    setActionError('')
    try {
      await fn()
      refresh()
    } catch (err) {
      setActionError(err && err.message ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const renderPlanActions = (plan) => (
    <Popup devId="p3b7k2w" panelClassName="new-session-panel">
      <NewSessionForm
        devId="p8m4x1v"
        providers={providers}
        workspaces={workspaces}
        defaults={{
          workspaceId: session.workspaceId,
          provider: session.provider,
          model: session.model,
          codex: session.codex,
          grok: session.grok,
          claude: session.claude,
        }}
        title="Build Plan"
        submitLabel="Build in new session"
        afterCreate={(created) => api.run(created.id, { prompt: `Implement this: \n${plan}`, mode: 'agent' })}
        onCreated={onCreated}
      />
      <Button variant="primary" size="sm" devId="p6r2c9t">
        Build plan in new session
      </Button>
    </Popup>
  )

  const chooseSpawnProvider = (value) => {
    const next = providers.find((item) => item.id === value)
    const models = next?.models || []
    const keepSessionModel = value === session.provider && models.some((entry) => entry.id === session.model)
    setSpawnProvider(value)
    setSpawnModel(keepSessionModel ? session.model : (models[0]?.id || ''))
  }

  const answer = (qid, value) =>
    api.answerQuestion(sessionId, qid, value).then(refresh)

  if (!session) {
    return (
      <DevScope id={devId}>
        <section className="session-view session-view--empty">
          <div className="session-view__empty-wrap">
            <p className="hint">Select a session from the sidebar to inspect activity.</p>
          </div>
        </section>
      </DevScope>
    )
  }

  return (
    <DevScope id={devId} state={{ session: sessionId, status, mode, busy, log: session.logPath, events: session.eventsPath }}>
      <section className="session-view">
        <header className="session-view__header">
          <div className="session-view__title">
            <Badge size="small" variant={STATUS_VARIANT[status] || 'neutral'}>{status}</Badge>
            <div className="session-view__headings">
              <div className="session-view__title-row">
                <span className="session-view__provider">
                  {session.name ? `${session.name} · ` : ''}
                  {session.provider}
                  {session.model ? ` (${session.model})` : ''}
                </span>
                {session.codex?.reasoningEffort && (
                  <Badge size="small" variant="neutral">{session.codex.reasoningEffort}</Badge>
                )}
                {session.grok?.reasoningEffort && (
                  <Badge size="small" variant="neutral">{session.grok.reasoningEffort}</Badge>
                )}
                {session.claude?.reasoningEffort && (
                  <Badge size="small" variant="neutral">{session.claude.reasoningEffort}</Badge>
                )}
              </div>
              <div className="session-view__paths">
                <span className="session-view__cwd" title={session.cwd}>
                  <FolderIcon size={12} className="session-view__folder-icon" />
                  {session.cwd}
                </span>
                {session.logPath && (
                  <span className="session-view__path-sub" title={session.logPath}>
                    log: {session.logPath}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="session-view__controls">
            <Button
              variant="secondary"
              size="sm"
              onClick={act(() => api.pause(sessionId))}
              disabled={busy || !isBusy}
              devId="hr8c4n1"
              title="Pause"
              aria-label="Pause"
            >
              <Icon d={ICONS.pause} />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={act(() => api.resume(sessionId))}
              disabled={busy || isBusy}
              devId="hr6p0s5"
              title={disconnected ? 'Reconnect and resume' : 'Resume'}
              aria-label={disconnected ? 'Reconnect and resume' : 'Resume'}
            >
              <Icon d={ICONS.resume} />
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={act(() => api.stop(sessionId))}
              disabled={busy || status === 'stopped'}
              devId="hr3l7q9"
              title="Stop"
              aria-label="Stop"
            >
              <Icon d={ICONS.stop} />
            </Button>
            <Button
              variant={sideOpen ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setSideOpen((prev) => !prev)}
              devId="h8w4c1x"
              title={sideOpen ? 'Collapse inspector' : 'Expand inspector'}
              aria-label={sideOpen ? 'Collapse inspector' : 'Expand inspector'}
            >
              <Icon d={ICONS.panel} />
            </Button>
          </div>
        </header>

        <div className={`session-view__body${sideOpen ? '' : ' session-view__body--side-collapsed'}`}>
          <div className="session-view__main">
            {!isBusy && session.lastError?.message && (
              <DevScope id="hr9w2b8">
                <div className="tx tx--error" role="alert">
                  <strong>{disconnected ? 'Network lost, press play to resume:' : 'Session Error:'}</strong> {session.lastError.message}
                </div>
              </DevScope>
            )}
            <Transcript devId="hr6v0n8" events={events} runs={runs} renderPlanActions={renderPlanActions} fontSize={transcriptFontSize} />

            {pendingQuestions.map((q) => (
              <QuestionCard key={q.id} devId="hr1p9t4" question={q} onAnswer={answer} />
            ))}
          </div>

          <aside className={`session-view__side${sideOpen ? '' : ' session-view__side--collapsed'}`}>
            {sideOpen ? (
              <>
                <DecomposeProgress session={session} />
                <Tabs defaultIndex={0}>
                  <TabList>
                    <Tab>Metrics</Tab>
                    <Tab>Daemon Log</Tab>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSideOpen(false)}
                      devId="hr4c8w2"
                      title="Collapse inspector"
                      aria-label="Collapse inspector"
                    >
                      →
                    </Button>
                  </TabList>
                  <TabPanel panelIndex={0}>
                    <MetricsPanel devId="hr0s6k9" session={session} runs={runs} />
                  </TabPanel>
                  <TabPanel panelIndex={1}>
                    <LogFold
                      devId="hr4j2p8"
                      sessionId={sessionId}
                      logPath={session.logPath}
                      refreshKey={`${status}:${latestRun?.id}:${latestRun?.endedAt}:${events.length}`}
                      active={isBusy}
                      hasFailure={hasFailure}
                    />
                  </TabPanel>
                </Tabs>
              </>
            ) : (
              <button
                type="button"
                className="session-view__side-collapsed-btn"
                onClick={() => setSideOpen(true)}
                title="Expand inspector"
                aria-label="Expand inspector"
              >
                <span className="session-view__side-collapsed-text">Metrics</span>
              </button>
            )}
          </aside>
        </div>

        <DevScope id="hr7a5x3" state={{ mode }}>
          <footer className={`composer${isDecompose ? ' composer--decompose' : ''}`}>
            <div className="composer__toolbar">
              <ModeToggle modes={modes} mode={mode} onChange={changeMode} disabled={busy} />
              <span className="composer__mode-hint">{active?.hint}</span>
            </div>
            {isNewChat && (
              <NewChatTarget
                providers={providers}
                provider={spawnProvider || session.provider}
                model={spawnModel}
                onProvider={chooseSpawnProvider}
                onModel={setSpawnModel}
              />
            )}
            <div className="composer__input-wrapper">
              <DevScope id="hr8r3c4">
                <textarea
                  className={`composer__input${isDecompose ? ' composer__input--plan' : ''}`}
                  placeholder={
                    steering
                      ? 'Steer the running agent (⌘↵ to interrupt and send)…'
                      : active?.placeholder || 'Prompt…'
                  }
                  value={speech.interim ? `${prompt} ${speech.interim}` : prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                  }}
                  rows={isDecompose ? 8 : 3}
                />
              </DevScope>
              <div className="composer__actions">
                <span className="composer__shortcut-hint">⌘↵ / Ctrl↵</span>
                {speech.supported && (
                  <Button
                    variant={speech.listening ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={speech.toggle}
                    aria-pressed={speech.listening}
                    devId="hr5v2m8"
                    title={speech.listening ? 'Stop dictation' : 'Start dictation'}
                    aria-label={speech.listening ? 'Stop dictation' : 'Start dictation'}
                  >
                    <span className={`composer__mic${speech.listening ? ' composer__mic--listening' : ''}`}>
                      <Icon d={ICONS.mic} />
                    </span>
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={send}
                  loading={busy}
                  disabled={sendDisabled}
                  devId="hr2t9h5"
                >
                  {steering ? 'Steer' : active?.sendLabel || 'Send'}
                </Button>
              </div>
            </div>
            {actionError ? <p className="composer__error hint hint--error" role="alert">{actionError}</p> : null}
            {speech.error ? <p className="composer__error hint hint--error" role="alert">Dictation error: {speech.error}</p> : null}
          </footer>
        </DevScope>
      </section>
    </DevScope>
  )
}

export default SessionView
