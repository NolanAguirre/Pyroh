import { useEffect, useMemo, useState } from 'react'
import { Button, DevScope, Popup, PromptInput, useSpeechRecognition } from 'component-library'
import { TRIGGERS } from 'prompt-triggers'
import useSessionEvents from '../useSessionEvents'
import api from '../api'
import Transcript from './Transcript'
import NewSessionForm from './NewSessionForm'
import QuestionCard from './QuestionCard'
import { Icon, ICONS } from './Session/icons'
import { readDrafts, replyMode, loadComposer, saveComposer } from './Session/composerDrafts'
import NewChatTarget from './Session/NewChatTarget'
import ModeToggle from './Session/ModeToggle'
import RunAfterControl, { eligibleRunAfterSessions } from './Session/RunAfterControl'
import SessionHeader from './Session/SessionHeader'
import SessionInspector from './Session/SessionInspector'
import ChildRuns from './Session/ChildRuns'
import { urlWithSelection } from '../appUrl'
import MODE_PANELS from './Session/modePanels'

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

// Sibling analysis modes that may run on a different provider and model than the source.
const SPAWN_TARGET_KINDS = ['token-waste', 'memory']
const QUEUED_RUN_AFTER = { prompt: '' }

const SessionView = ({ devId, sessionId, initialSession, providers = [], workspaces = [], sessions = [], modes: registryModes, onChanged, onCreated, transcriptFontSize }) => {
  const { events, session: liveSession, runs, children, queuedMessages, questions, pendingQuestions, connected } = useSessionEvents(sessionId)
  const session = liveSession || initialSession
  const defaultMode = replyMode(session)
  const [mode, setMode] = useState(() => loadComposer(sessionId, defaultMode).mode)
  const [prompt, setPromptState] = useState(() => loadComposer(sessionId, defaultMode).prompt)
  const [spawnMode, setSpawnMode] = useState('agent')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [sideOpen, setSideOpen] = useState(false)
  const [handoffRunId, setHandoffRunId] = useState(null)
  const [spawnProvider, setSpawnProvider] = useState(session?.provider || '')
  const [spawnModel, setSpawnModel] = useState(session?.model || '')
  const [filter, setFilter] = useState(null)
  const [runAfterOn, setRunAfterOn] = useState(false)
  const [runAfterSessionId, setRunAfterSessionId] = useState('')
  const [runsKnown, setRunsKnown] = useState(false)
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

  // The session can load after mount; without a draft, follow its mode.
  useEffect(() => {
    if (!readDrafts()[sessionId]) setMode(defaultMode)
  }, [sessionId, defaultMode])

  useEffect(() => {
    setFilter(null)
  }, [sessionId])

  useEffect(() => {
    if (connected) setRunsKnown(true)
  }, [connected])

  useEffect(() => {
    saveComposer(sessionId, mode, prompt, defaultMode)
  }, [sessionId, mode, prompt, defaultMode])

  const modes = registryModes?.length ? registryModes : FALLBACK_MODES
  const registryActive = modes.find((item) => item.id === mode) || null
  // Sending a sibling mode to a session already in it replies here instead of spawning.
  const replyInPlace = Boolean(registryActive?.newSession) && registryActive.kind !== 'fork' && session?.mode === registryActive.id
  const active = replyInPlace
    ? {
        ...registryActive,
        newSession: false,
        promptOptional: false,
        hint: `Reply in this ${registryActive.label} session, keeping its tools.`,
        sendLabel: 'Send',
        placeholder: 'Reply to the agent (⌘↵ to send)…',
      }
    : registryActive
  const isDecompose = active?.kind === 'decompose'
  const isNewChat = active?.kind === 'new-chat'
  const isFork = active?.kind === 'fork'
  const picksSpawnTarget = isNewChat || (Boolean(active?.newSession) && SPAWN_TARGET_KINDS.includes(active?.kind))

  // A saved mode that this workspace no longer has falls back to the session's mode, then agent.
  useEffect(() => {
    if (!registryModes?.length || registryModes.some((item) => item.id === mode)) return
    setMode(registryModes.some((item) => item.id === defaultMode) ? defaultMode : 'agent')
  }, [registryModes, mode, defaultMode])

  const status = session?.status || 'idle'
  const queued = status === 'queued'
  const isBusy = status === 'running' || status === 'awaiting_input'
  const disconnected = status === 'disconnected'
  const specialRun = isDecompose || isNewChat || Boolean(active?.newSession)
  const submitted = runs.length > 0 || events.some((event) => event.type === 'user')
  const showRunAfter = runsKnown && !submitted && !queued && !specialRun
  const eligible = useMemo(() => eligibleRunAfterSessions(sessions, sessionId), [sessions, sessionId])
  const dependencyId = runAfterOn && !specialRun
    ? (eligible.find((item) => item.id === runAfterSessionId)?.id || '')
    : ''
  const latestRun = runs[runs.length - 1]
  const hasFailure = Boolean(session?.lastError?.message || latestRun?.error || latestRun?.transcriptError)
  const promptRequired = isFork || !active?.promptOptional
  const spawnsSession = Boolean(active?.newSession)
  const blocksWhileBusy = !spawnsSession
  const steering = isBusy && active?.steerable !== false && !spawnsSession
  const canQueue = submitted && (!session?.parentSessionId || session.childKind === 'fork') && !spawnsSession
    && ['turn', 'plugin'].includes(active?.kind)
  const queueDisabled = !canQueue || queued || !prompt.trim()
  const spawnEntry = providers.find((item) => item.id === spawnProvider)
  const spawnModelId = spawnModel || spawnEntry?.models?.[0]?.id || null
  const spawnBlocked = picksSpawnTarget && Boolean(spawnEntry) && (spawnEntry.implemented === false || spawnEntry.error)
  const runAfterBlocked = showRunAfter && runAfterOn && !dependencyId
  const sendDisabled = queued || runAfterBlocked || (steering
    ? !prompt.trim()
    : (blocksWhileBusy && isBusy) || (promptRequired && !prompt.trim()) || spawnBlocked)

  useEffect(() => {
    if (!eligible.length) {
      setRunAfterOn(false)
      return
    }
    if (runAfterSessionId && !eligible.some((item) => item.id === runAfterSessionId)) setRunAfterSessionId('')
  }, [eligible, runAfterSessionId])

  useEffect(() => {
    if (!handoffRunId) return
    const handoff = events.find((event) => event.type === 'handoff' && event.runId === handoffRunId)
    if (!handoff) return
    setHandoffRunId(null)
    onCreated?.(handoff.session)
  }, [events, handoffRunId, onCreated])

  const ModePanel = MODE_PANELS[session?.mode] || null
  const inFilter = (item) => (item.phase || 0) === filter.phase && item.step === filter.step
  const shownEvents = ModePanel && filter ? events.filter(inFilter) : events
  const shownRuns = ModePanel && filter ? runs.filter(inFilter) : runs
  const shownQuestions = ModePanel && filter
    ? questions.filter((question) => shownRuns.some((run) => run.id === question.runId))
    : questions

  const refresh = () => {
    if (onChanged) onChanged()
  }

  const submitMessage = async (delivery) => {
    if (busy || (delivery === 'queue' ? queueDisabled : sendDisabled)) return
    speech.stop()
    setBusy(true)
    setActionError('')
    try {
      if (delivery === 'queue') await api.queueMessage(sessionId, { prompt, mode })
      else if (steering) await api.steer(sessionId, prompt)
      else if (isDecompose) await api.decompose(sessionId, prompt)
      else {
        const target = { provider: spawnProvider || session.provider, model: spawnModelId }
        const reply = dependencyId
          ? {
              prompt,
              mode,
              provider: session.provider,
              ...(session.model ? { model: session.model } : {}),
              runAfterSessionId: dependencyId,
            }
          : { prompt, mode }
        const result = await api.run(sessionId, isNewChat
          ? { prompt, mode, ...target, targetMode: spawnMode }
          : picksSpawnTarget ? { prompt, mode, ...target } : reply)
        if (isFork && result.run?.sessionId && result.run.sessionId !== sessionId) {
          // The run identifies the fork; the response session can still be the source.
          const fork = result.session?.id === result.run.sessionId
            ? result.session
            : (await api.getSession(result.run.sessionId)).session
          saveComposer(sessionId, defaultMode, '', defaultMode)
          setMode(defaultMode)
          onCreated?.(fork)
        } else if (result.session && !isFork) onCreated?.(result.session)
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

  const send = () => submitMessage('send')
  const queueMessage = () => submitMessage('queue')

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
      <section
        className="session-view"
        style={Number.isInteger(transcriptFontSize) ? { '--transcript-font-size': `${transcriptFontSize}px` } : undefined}
      >
        <SessionHeader
          session={session}
          status={status}
          isBusy={isBusy}
          disconnected={disconnected}
          busy={busy}
          sideOpen={sideOpen}
          onPause={act(() => api.pause(sessionId))}
          onResume={act(() => api.resume(sessionId))}
          onStop={act(() => api.stop(sessionId))}
          onToggleSide={() => setSideOpen((prev) => !prev)}
        />

        <div className={`session-view__body${sideOpen ? '' : ' session-view__body--side-collapsed'}`}>
          <div className="session-view__main">
            {session.parentSessionId && (
              <p className="hint">
                {session.childKind === 'workflow' && <>{session.name || `Workflow step${session.workflow?.phase ? ` · Phase ${session.workflow.phase}` : ''}${session.workflow?.step ? ` · ${session.workflow.step}` : ''}`} · </>}
                <a href={urlWithSelection(new URL(window.location.href), session.workspaceId, session.parentSessionId, null, null, null).href}>
                  {session.childKind === 'fork' ? 'Forked from' : session.childKind === 'workflow' ? 'Parent workflow' : 'Parent session'}{session.parentRunId ? ` · ${session.parentRunId}` : ''}
                </a>
              </p>
            )}
            {ModePanel && (
              <ModePanel session={session} runs={runs} events={events} filter={filter} setFilter={setFilter} />
            )}
            {!isBusy && session.lastError?.message && (
              <DevScope id="hr9w2b8">
                <div className="tx tx--error" role="alert">
                  <strong>{disconnected ? 'Network lost, press play to resume:' : 'Session Error:'}</strong> {session.lastError.message}
                </div>
              </DevScope>
            )}
            <Transcript
              devId="hr6v0n8"
              events={shownEvents}
              runs={shownRuns}
              questions={shownQuestions}
              renderPlanActions={renderPlanActions}
              fontSize={transcriptFontSize}
              queued={queued ? (session.runAfter || QUEUED_RUN_AFTER) : null}
              workspaceId={session.workspaceId}
              viewerSessionId={sessionId}
            />

            <ChildRuns session={session} runs={runs} children={children} />

            {pendingQuestions.map((q) => (
              <QuestionCard key={q.id} devId="hr1p9t4" question={q} onAnswer={answer} />
            ))}
          </div>

          <SessionInspector
            sessionId={sessionId}
            session={session}
            runs={runs}
            isBusy={isBusy}
            hasFailure={hasFailure}
            refreshKey={`${status}:${latestRun?.id}:${latestRun?.endedAt}:${events.length}`}
            sideOpen={sideOpen}
            setSideOpen={setSideOpen}
          />
        </div>

        <DevScope id="hr7a5x3" state={{ mode }}>
          <footer className={`composer${isDecompose ? ' composer--decompose' : ''}`}>
            {queuedMessages.length > 0 && (
              <div className="composer__queue" aria-label="Queued messages">
                <p className="hint" role="status">
                  {queuedMessages.length} queued {queuedMessages.length === 1 ? 'message' : 'messages'} · Sent in order after the current turn ends
                </p>
                <ol className="composer__queue-list">
                  {queuedMessages.map((message) => (
                    <li key={message.id} className="composer__queue-item">
                      <div className="composer__queue-message">
                        <span className="composer__queue-mode">{modes.find((item) => item.id === message.mode)?.label || message.mode}</span>
                        <span className="composer__queue-text">{message.text}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={act(() => api.removeQueuedMessage(sessionId, message.id))}
                        aria-label={`Remove queued message: ${message.text}`}
                        devId="hqu7r2m"
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="composer__toolbar">
              <div className="composer__toolbar-start">
                <ModeToggle modes={modes} mode={mode} onChange={changeMode} disabled={busy} />
                {showRunAfter && (
                  <RunAfterControl
                    sessions={eligible}
                    checked={runAfterOn}
                    sessionId={runAfterSessionId}
                    onChecked={setRunAfterOn}
                    onSession={setRunAfterSessionId}
                  />
                )}
              </div>
              <span className="composer__mode-hint">{active?.hint}</span>
            </div>
            {picksSpawnTarget && (
              <NewChatTarget
                providers={providers}
                provider={spawnProvider || session.provider}
                model={spawnModel}
                onProvider={chooseSpawnProvider}
                onModel={setSpawnModel}
                modes={isNewChat ? modes : undefined}
                targetMode={isNewChat ? spawnMode : undefined}
                onTargetMode={isNewChat ? setSpawnMode : undefined}
              />
            )}
            <div className="composer__input-wrapper">
              <DevScope id="hr8r3c4">
                <PromptInput
                  className={`composer__input${isDecompose ? ' composer__input--plan' : ''}`}
                  triggers={TRIGGERS}
                  first={!steering && (spawnsSession || !session?.providerAgentId)}
                  placeholder={
                    steering
                      ? 'Send to interrupt, or Queue for after this turn (⌘↵ to send)…'
                      : active?.placeholder || 'Prompt…'
                  }
                  value={speech.interim ? `${prompt} ${speech.interim}` : prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onSubmit={send}
                  disabled={queued}
                  rows={isDecompose ? 8 : 3}
                />
              </DevScope>
              <div className="composer__actions">
                <span className="composer__shortcut-hint">⌘↵ / Ctrl↵</span>
                {canQueue && (
                  <Button
                    variant="secondary"
                    onClick={queueMessage}
                    disabled={busy || queueDisabled}
                    title="Send after the current turn ends, without interrupting"
                    devId="hqu4s8n"
                  >
                    Queue
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={send}
                  loading={busy}
                  disabled={sendDisabled}
                  title={steering ? 'Interrupt the current turn and send' : undefined}
                  devId="hr2t9h5"
                >
                  {steering ? 'Send' : active?.sendLabel || 'Send'}
                </Button>
                {speech.supported && (
                  <Button
                    variant={speech.listening ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={speech.toggle}
                    aria-pressed={speech.listening}
                    devId="hr5v2m8"
                    title={speech.preparing ? 'Cancel dictation setup' : speech.listening ? 'Stop dictation' : 'Start dictation'}
                    aria-label={speech.preparing ? 'Cancel dictation setup' : speech.listening ? 'Stop dictation' : 'Start dictation'}
                    aria-busy={speech.preparing}
                  >
                    <span className={`composer__mic${speech.listening ? ' composer__mic--listening' : ''}`}>
                      <Icon d={ICONS.mic} />
                    </span>
                  </Button>
                )}
              </div>
            </div>
            {actionError ? <p className="composer__error hint hint--error" role="alert">{actionError}</p> : null}
            {speech.status ? <p className="hint" role="status">{speech.status}</p> : null}
            {speech.error ? <p className="composer__error hint hint--error" role="alert">Dictation error: {speech.error}</p> : null}
          </footer>
        </DevScope>
      </section>
    </DevScope>
  )
}

export default SessionView
