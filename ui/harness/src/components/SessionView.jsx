import { useEffect, useState } from 'react'
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
import SessionHeader from './Session/SessionHeader'
import SessionInspector from './Session/SessionInspector'

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

const SessionView = ({ devId, sessionId, initialSession, providers = [], workspaces = [], modes: registryModes, onChanged, onCreated, transcriptFontSize }) => {
  const { events, session: liveSession, runs, pendingQuestions } = useSessionEvents(sessionId)
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
    saveComposer(sessionId, mode, prompt, defaultMode)
  }, [sessionId, mode, prompt, defaultMode])

  const modes = registryModes?.length ? registryModes : FALLBACK_MODES
  const registryActive = modes.find((item) => item.id === mode) || null
  // Sending a sibling mode to a session already in it replies here instead of spawning.
  const replyInPlace = Boolean(registryActive?.newSession) && session?.mode === registryActive.id
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
  const picksSpawnTarget = isNewChat || (Boolean(active?.newSession) && SPAWN_TARGET_KINDS.includes(active?.kind))

  // A saved mode that this workspace no longer has falls back to the session's mode, then agent.
  useEffect(() => {
    if (!registryModes?.length || registryModes.some((item) => item.id === mode)) return
    setMode(registryModes.some((item) => item.id === defaultMode) ? defaultMode : 'agent')
  }, [registryModes, mode, defaultMode])

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
  const spawnBlocked = picksSpawnTarget && Boolean(spawnEntry) && (spawnEntry.implemented === false || spawnEntry.error)
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
        const target = { provider: spawnProvider || session.provider, model: spawnModelId }
        const result = await api.run(sessionId, isNewChat
          ? { prompt, mode, ...target, targetMode: spawnMode }
          : picksSpawnTarget ? { prompt, mode, ...target } : { prompt, mode })
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
            <div className="composer__toolbar">
              <ModeToggle modes={modes} mode={mode} onChange={changeMode} disabled={busy} />
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
                  steer={steering}
                  placeholder={
                    steering
                      ? 'Steer the running agent (⌘↵ to interrupt and send)…'
                      : active?.placeholder || 'Prompt…'
                  }
                  value={speech.interim ? `${prompt} ${speech.interim}` : prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onSubmit={send}
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
