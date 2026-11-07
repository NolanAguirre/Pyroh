import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DevScope, ImageAttachments, Popup, PromptInput, SplitPane, useSpeechRecognition } from 'component-library'
import { INPUT_COMMANDS, TRIGGERS, parseInputCommand } from 'prompt-triggers'
import useSessionEvents from '../useSessionEvents'
import api from '../api'
import Transcript from './Transcript'
import NewSessionForm from './NewSessionForm'
import QuestionCard from './QuestionCard'
import { Icon, ICONS } from './Session/icons'
import { readDrafts, replyMode, loadComposer, saveComposer } from './Session/composerDrafts'
import usePromptSubmission, { loadPromptSubmission } from './Session/usePromptSubmission'
import useSessionImages from './Session/useSessionImages'
import SessionImagePreviews from './Session/SessionImagePreviews'
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

const QUEUED_RUN_AFTER = { prompt: '' }
const forkRetryStorageKey = (sessionId) => `harness.forkRetry.${sessionId}`
const loadForkRetry = (sessionId) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(forkRetryStorageKey(sessionId)) || 'null')
    return typeof saved?.key === 'string' && typeof saved?.prompt === 'string' ? saved : null
  } catch {
    return null
  }
}
const saveForkRetry = (sessionId, retry) => {
  try {
    if (retry) sessionStorage.setItem(forkRetryStorageKey(sessionId), JSON.stringify(retry))
    else sessionStorage.removeItem(forkRetryStorageKey(sessionId))
  } catch {
    // Keep the in-memory key when browser storage is unavailable.
  }
}

const SessionView = ({ devId, sessionId, initialSession, providers = [], workspaces = [], sessions = [], modes: registryModes, onChanged, onCreated, transcriptFontSize }) => {
  const { events, session: liveSession, runs, children, queuedMessages, submissions, questions, pendingQuestions, connected } = useSessionEvents(sessionId)
  const session = liveSession || initialSession
  const defaultMode = replyMode(session)
  const [savedSubmission] = useState(() => loadPromptSubmission(sessionId))
  const [mode, setMode] = useState(() => savedSubmission?.context.mode || loadComposer(sessionId, defaultMode).mode)
  const [prompt, setPromptState] = useState(() => savedSubmission?.request.prompt ?? loadComposer(sessionId, defaultMode).prompt)
  const [initialImages] = useState(() => savedSubmission ? {
    attachments: (savedSubmission.request.images || []).map((image) => ({ key: image.id, name: image.name, image })),
  } : loadComposer(sessionId, defaultMode))
  const attachments = useSessionImages(sessionId, initialImages)
  const promptLocked = useRef(Boolean(savedSubmission))
  const acceptSpeech = useRef(true)
  const forkRetry = useRef({ sessionId, retry: loadForkRetry(sessionId) })
  const [spawnMode, setSpawnMode] = useState('agent')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [commandNotice, setCommandNotice] = useState('')
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
    onFinal: (text) => {
      if (!promptLocked.current && acceptSpeech.current) setPrompt((prev) => (prev && !prev.endsWith(' ') ? `${prev} ${text.trim()}` : `${prev}${text.trim()}`))
    },
  })

  const changeMode = (next) => {
    if (promptLocked.current || next === mode) return
    speech.stop()
    setMode(next)
  }

  // The session can load after mount; without a draft, follow its mode.
  useEffect(() => {
    if (!promptLocked.current && !readDrafts()[sessionId]) setMode(defaultMode)
  }, [sessionId, defaultMode])

  useEffect(() => {
    setFilter(null)
    setCommandNotice('')
  }, [sessionId])

  useEffect(() => {
    if (connected) setRunsKnown(true)
  }, [connected])

  useEffect(() => {
    saveComposer(sessionId, mode, prompt, defaultMode, attachments.draftItems, attachments.error)
  }, [sessionId, mode, prompt, defaultMode, attachments.draftItems, attachments.error])

  useEffect(() => {
    if (forkRetry.current.sessionId !== sessionId) {
      forkRetry.current = { sessionId, retry: loadForkRetry(sessionId) }
    }
    if (forkRetry.current.retry && forkRetry.current.retry.prompt !== prompt) {
      forkRetry.current.retry = null
      saveForkRetry(sessionId, null)
    }
  }, [sessionId, prompt])

  const modes = registryModes?.length ? registryModes : FALLBACK_MODES
  const registryActive = modes.find((item) => item.id === mode) || null
  // Sending a sibling mode to a session already in it replies here instead of spawning.
  const replyInPlace = Boolean(registryActive?.newSession) && registryActive.kind !== 'fork'
    && registryActive.interaction !== 'fork' && session?.mode === registryActive.id
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
  const isDecompose = ['workflow', 'decompose'].includes(active?.kind)
  const isNewChat = active?.interaction === 'continuation' || active?.kind === 'new-chat'
  const isFork = active?.interaction === 'fork' || active?.kind === 'fork'
  const nativeForkUnavailable = isFork && ['cursor', 'grok'].includes(session?.provider)
  const modeHint = nativeForkUnavailable
    ? `Native forks are unavailable for ${session.provider === 'cursor' ? 'Cursor' : 'Grok'}. Existing fork sessions still accept replies.`
    : isFork ? `${active?.hint || ''} Cache reuse is measured by the provider and is not guaranteed.` : active?.hint
  const picksSpawnTarget = isNewChat || (Boolean(active?.newSession) && !isFork)

  // A saved mode that this workspace no longer has falls back to the session's mode, then agent.
  useEffect(() => {
    if (promptLocked.current || !registryModes?.length || registryModes.some((item) => item.id === mode)) return
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
  const blocksWhileBusy = isFork || !spawnsSession
  const steering = isBusy && active?.steerable !== false && !spawnsSession
  const canQueue = submitted && session?.childKind !== 'workflow' && !spawnsSession && !isNewChat && !isFork
    && ['turn', 'plugin'].includes(active?.kind)
  const inputCommand = parseInputCommand(prompt)
  const commandEntry = INPUT_COMMANDS.find((item) => item.type === inputCommand?.type)
  const hasImages = attachments.items.length > 0
  const hasContent = Boolean(prompt.trim()) || hasImages
  const imageModeError = hasImages && (inputCommand
    ? 'Commands cannot include images. Remove the images or change the prompt.'
    : isDecompose || isNewChat || isFork || spawnsSession || session?.workflowPlugin || session?.childKind === 'workflow'
      ? 'Images are not supported in this workflow. Use an ordinary session or remove the images.'
      : '')
  const imagesBlocked = attachments.blocked || Boolean(imageModeError)
  const queueDisabled = imagesBlocked || Boolean(inputCommand) || !canQueue || queued || !hasContent
  const spawnEntry = providers.find((item) => item.id === spawnProvider)
  const spawnModelId = spawnModel || spawnEntry?.models?.[0]?.id || null
  const spawnBlocked = picksSpawnTarget && Boolean(spawnEntry) && (spawnEntry.implemented === false || spawnEntry.error)
  const runAfterBlocked = showRunAfter && runAfterOn && !dependencyId
  const sendDisabled = imagesBlocked || (!inputCommand && (queued || runAfterBlocked || nativeForkUnavailable || (isFork && !submitted) || (steering
    ? !hasContent
    : (blocksWhileBusy && isBusy) || (promptRequired && !hasContent) || spawnBlocked)))

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

  const submission = usePromptSubmission({
    sessionId,
    submissions,
    connected,
    onSuccess: (result, sent) => {
      const { mode: sentMode, defaultMode: sentDefault, isFork: sentFork, isNewChat: sentNewChat } = sent.context
      saveComposer(sessionId, sentFork ? sentDefault : sentMode, '', sentDefault)
      setPrompt('')
      attachments.clear()
      if (result.checkpoint) {
        setCommandNotice(`Checkpoint “${result.checkpoint.name}” created at ${new Date(result.checkpoint.at).toLocaleString()}. Available in analytics.`)
      }
      if (sentFork) {
        forkRetry.current.retry = null
        saveForkRetry(sessionId, null)
        setMode(sentDefault)
      }
      if (sentNewChat && result.run?.id) setHandoffRunId(result.run.id)
      if (result.session && (!sentFork || result.session.id === result.run?.sessionId)) onCreated?.(result.session)
      refresh()
    },
  })
  promptLocked.current = Boolean(submission.pending)
  const composerBusy = busy || Boolean(submission.pending) || submission.requestBusy

  const submitMessage = (delivery) => {
    if (composerBusy || promptLocked.current || (delivery === 'queue' ? queueDisabled : sendDisabled)) return
    promptLocked.current = true
    acceptSpeech.current = false
    speech.stop()
    setActionError('')
    setCommandNotice('')
    saveComposer(sessionId, mode, prompt, defaultMode, attachments.draftItems, attachments.error)
    const action = inputCommand ? 'commands' : delivery === 'queue' ? 'queue' : steering ? 'steer' : 'run'
    const request = { action, prompt, mode, ...(attachments.images.length ? { images: attachments.images } : {}) }
    if (action === 'run') {
      if (dependencyId) {
        request.provider = session.provider
        if (session.model) request.model = session.model
        request.runAfterSessionId = dependencyId
      }
      if (picksSpawnTarget) {
        request.provider = spawnProvider || session.provider
        request.model = spawnModelId
        if (isNewChat) request.targetMode = spawnMode
      }
      if (isFork) {
        const saved = forkRetry.current.sessionId === sessionId ? forkRetry.current.retry : loadForkRetry(sessionId)
        const retry = saved?.prompt === prompt ? saved : { prompt, key: crypto.randomUUID() }
        forkRetry.current = { sessionId, retry }
        saveForkRetry(sessionId, retry)
        request.forkRetryKey = retry.key
      }
    }
    submission.submit(request, { mode, defaultMode, isFork: action === 'run' && isFork, isNewChat: action === 'run' && isNewChat })
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

        <SplitPane
          className="session-view__split"
          direction="vertical"
          primary="second"
          defaultSize={420}
          minSize={200}
          maxSize={900}
          storageKey="harness.composer.height"
          devId="hr4m8q6"
        >
        <div className={`session-view__body${sideOpen ? '' : ' session-view__body--side-collapsed'}`}>
          <div className="session-view__main">
            {children.length > 0 && (
              <div className="session-view__pinned">
                <ChildRuns devId="dyrp8jw" session={session} runs={runs} children={children} />
              </div>
            )}
            <div className="session-view__scroll">
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

            {pendingQuestions.map((q) => (
              <QuestionCard key={q.id} devId="hr1p9t4" question={q} onAnswer={answer} />
            ))}
            </div>
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
              <DevScope id="xo86vu7" state={{ count: queuedMessages.length }}>
                <div className="composer__queue" aria-label="Queued messages">
                  <p className="hint" role="status">
                    {queuedMessages.length} queued {queuedMessages.length === 1 ? 'message' : 'messages'} · Sent in order after the current turn ends
                  </p>
                  <ol className="composer__queue-list">
                    {queuedMessages.map((message) => (
                      <DevScope key={message.id} id="nu6hv3h" state={{ message: message.id, mode: message.mode }}>
                        <li className="composer__queue-item">
                          <div className="composer__queue-message">
                            <span className="composer__queue-mode">{modes.find((item) => item.id === message.mode)?.label || message.mode}</span>
                            <span className="composer__queue-text">{message.text}</span>
                            <SessionImagePreviews images={message.images} sessionId={sessionId} />
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={act(() => api.sendQueuedMessage(sessionId, message.id))}
                            title="Send immediately, interrupting the current turn if needed"
                            aria-label={`Send queued message now: ${message.text}`}
                            devId="hqu9n3s"
                          >
                            Send now
                          </Button>
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
                      </DevScope>
                    ))}
                  </ol>
                </div>
              </DevScope>
            )}
            <div className="composer__toolbar">
              <div className="composer__toolbar-start">
                <ModeToggle modes={modes} mode={mode} onChange={changeMode} disabled={composerBusy} />
                {showRunAfter && (
                  <RunAfterControl
                    sessions={eligible}
                    checked={runAfterOn}
                    sessionId={runAfterSessionId}
                    onChecked={setRunAfterOn}
                    onSession={setRunAfterSessionId}
                    disabled={composerBusy}
                  />
                )}
              </div>
              <span className="composer__mode-hint">{inputCommand ? commandEntry?.description : modeHint}</span>
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
                disabled={composerBusy}
              />
            )}
            <ImageAttachments
              className="composer__attachments"
              items={attachments.items}
              onFiles={attachments.add}
              onRemove={attachments.remove}
              onRetry={attachments.retry}
              error={attachments.error}
              onError={attachments.setError}
              onDismissError={() => attachments.setError('')}
              disabled={composerBusy}
              hint="PNG, JPEG, GIF or WebP · up to 5 images · 10 MiB each · paste or drop here"
            >
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
                  value={!submission.pending && acceptSpeech.current && speech.interim ? `${prompt} ${speech.interim}` : prompt}
                  readOnly={Boolean(submission.pending)}
                  aria-busy={Boolean(submission.pending)}
                  onChange={(e) => { if (!promptLocked.current) setPrompt(e.target.value) }}
                  onSubmit={send}
                  rows={isDecompose ? 8 : 3}
                />
              </DevScope>
              <div className="composer__actions">
                <span className="composer__shortcut-hint">⌘↵ / Ctrl↵</span>
                {canQueue && (
                  <Button
                    variant="secondary"
                    onClick={queueMessage}
                    disabled={composerBusy || queueDisabled}
                    title="Send after the current turn ends, without interrupting"
                    devId="hqu4s8n"
                  >
                    Queue
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={send}
                  loading={composerBusy}
                  disabled={composerBusy || sendDisabled || submission.requestBusy}
                  title={inputCommand ? commandEntry?.description : nativeForkUnavailable ? modeHint : steering ? 'Interrupt the current turn and send' : undefined}
                  devId="hr2t9h5"
                >
                  {inputCommand ? commandEntry?.label || 'Run command' : steering ? 'Send' : active?.sendLabel || 'Send'}
                </Button>
                {speech.supported && (
                  <Button
                    variant={speech.listening ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => { acceptSpeech.current = true; speech.toggle() }}
                    disabled={composerBusy}
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
            </ImageAttachments>
            {imageModeError && <p className="composer__error hint hint--error" role="alert">{imageModeError}</p>}
            {attachments.items.some((item) => item.status !== 'ready') && <p className="hint" role="status">Finish uploading, retry, or remove failed images before sending.</p>}
            {submission.pending && (
              <p className="hint" role="status">
                {submission.pending.received ? 'Received. Waiting for acceptance…' : 'Sending…'}
                {!connected ? ' Connection lost; your prompt is saved while we reconnect.' : ''}
              </p>
            )}
            {actionError || submission.error ? <p className="composer__error hint hint--error" role="alert">{actionError || submission.error}</p> : null}
            {submission.pending && submission.error && (
              <Button variant="secondary" size="sm" onClick={submission.retry} disabled={submission.requestBusy} devId="hr8s4r2">
                Retry confirmation
              </Button>
            )}
            {commandNotice ? <p className="hint" role="status">{commandNotice}</p> : null}
            {commandEntry ? <p className="hint">Command: {commandEntry.usage}</p> : null}
            {speech.status ? <p className="hint" role="status">{speech.status}</p> : null}
            {speech.error ? <p className="composer__error hint hint--error" role="alert">Dictation error: {speech.error}</p> : null}
          </footer>
        </DevScope>
        </SplitPane>
      </section>
    </DevScope>
  )
}

export default SessionView
