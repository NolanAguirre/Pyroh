import { Badge, Button, DevScope, ProgressBar } from 'component-library'
import { urlWithSelection } from '../../appUrl'

// Mirrors services/harness/src/modes/decompose/pipeline.js step order.
const ONCE_STEPS = ['count']
const EACH_PHASE_STEPS = ['plan', 'execute']

const STATE_VARIANT = {
  done: 'success',
  active: 'primary',
  pending: 'neutral',
  failed: 'danger',
  paused: 'warning',
}

const positionOf = (phase, step) => (phase
  ? ONCE_STEPS.length + (phase - 1) * EACH_PHASE_STEPS.length + EACH_PHASE_STEPS.indexOf(step)
  : ONCE_STEPS.indexOf(step))

const latestRunFor = (runs, phase, step) => {
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i]
    if ((run.phase || 0) === phase && run.step === step) return run
  }
  return null
}

const sessionState = (status) => {
  if (status === 'running' || status === 'awaiting_input') return 'active'
  if (status === 'error' || status === 'disconnected') return 'failed'
  return 'paused'
}

const runState = (run, status) => {
  if (run.status === 'completed') return 'done'
  if (run.status === 'error' || run.status === 'disconnected') return 'failed'
  if (run.status === 'cancelled') return 'paused'
  return sessionState(status)
}

const chipState = (session, run, phase, step) => {
  if (run) return runState(run, session.status)
  if (session.currentStep === 'done') return 'done'
  if (session.currentStep == null) return 'pending'
  const current = positionOf(session.currentPhase || 0, session.currentStep)
  const own = positionOf(phase, step)
  if (own < current) return 'done'
  if (own > current) return 'pending'
  return sessionState(session.status)
}

const StepChip = ({ session, runs, phase, step, filter, setFilter }) => {
  const run = latestRunFor(runs, phase, step)
  const state = chipState(session, run, phase, step)
  const childSessionId = run?.childSessionId
  const selected = !childSessionId && filter?.phase === phase && filter?.step === step
  const error = state === 'failed' ? run?.error || session.lastError?.message : null
  return (
    <div className={`decompose-panel__chip decompose-panel__chip--${state}`}>
      <Button
        variant={selected ? 'secondary' : 'ghost'}
        size="sm"
        aria-pressed={childSessionId ? undefined : selected}
        onClick={() => {
          if (childSessionId) {
            window.location.assign(urlWithSelection(new URL(window.location.href), session.workspaceId, childSessionId, null, null, null).href)
          } else {
            setFilter(selected ? null : { phase, step })
          }
        }}
        devId="dp4c7s2"
        title={`${step}: ${state}${childSessionId ? ' · Open child transcript' : ''}`}
      >
        <Badge variant={STATE_VARIANT[state]} size="small">{step}</Badge>
      </Button>
      {error && <span className="decompose-panel__error hint hint--error" title={error}>{error}</span>}
    </div>
  )
}

const DecomposePanel = ({ session, runs, filter, setFilter }) => {
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
  const phases = Array.from({ length: total }, (_, i) => i + 1)
  const chip = (p, s) => (
    <StepChip key={s} session={session} runs={runs} phase={p} step={s} filter={filter} setFilter={setFilter} />
  )

  return (
    <DevScope id="dp1e4t6" state={{ phase, step, status: session.status, filter }}>
      <div className="decompose-panel">
        <div className="decompose-panel__top">
          <div className="decompose-panel__progress">
            <ProgressBar
              label={label}
              value={done ? total : Math.max(phase, 0)}
              max={total || 1}
              status={barStatus}
              animated={barStatus === 'uploading'}
              showValue={Boolean(total)}
            />
          </div>
          {step && !done && <span className="hint">Step: {step}</span>}
          <Button
            variant={filter ? 'ghost' : 'secondary'}
            size="sm"
            aria-pressed={!filter}
            onClick={() => setFilter(null)}
            devId="dp8a2l5"
          >
            All
          </Button>
        </div>
        <div className="decompose-panel__rows">
          <div className="decompose-panel__row">
            <span className="decompose-panel__row-label">Setup</span>
            {ONCE_STEPS.map((s) => chip(0, s))}
          </div>
          {phases.map((p) => (
            <div key={p} className={`decompose-panel__row${p === phase ? ' decompose-panel__row--current' : ''}`}>
              <span className="decompose-panel__row-label">Phase {p}</span>
              {EACH_PHASE_STEPS.map((s) => chip(p, s))}
            </div>
          ))}
        </div>
      </div>
    </DevScope>
  )
}

export default DecomposePanel
