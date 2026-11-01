import { DevScope, ProgressBar } from 'component-library'

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

export default DecomposeProgress
