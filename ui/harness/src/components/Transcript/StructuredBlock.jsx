import { Badge, DevScope, Fold, FoldTrigger, FoldContent } from 'component-library'

const displayText = (value) => {
  if (value == null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

const StructuredBlock = ({ event }) => {
  const plan = event.plan ?? []
  // Live and persisted provider events can contain text or malformed steps.
  const isStepList = Array.isArray(plan) && plan.every((step) => step
    && typeof step.step === 'string'
    && (step.status == null || typeof step.status === 'string'))
  const explanation = displayText(event.explanation)

  return (
  <DevScope id="hr4f8s6" state={{ type: event.type }}>
    <div className="tx tx--tool">
      <Fold>
        <FoldTrigger>
          <div className="tx__fold-header">
            <span>{event.type === 'diff' ? 'Changes / Diff' : 'Plan Breakdown'}</span>
          </div>
        </FoldTrigger>
        <FoldContent>
          {event.type === 'diff' ? (
            <pre className="tx__pre tx__pre--diff">{event.diff}</pre>
          ) : (
            <div className="tx__plan-content">
              {explanation && <p className="tx__plan-expl">{explanation}</p>}
              {isStepList ? <ol className="tx__plan-list">
                {plan.map((step, i) => (
                  <li key={i} className="tx__plan-step">
                    <span className="tx__plan-step-text">{step.step}</span>
                    <Badge size="small" variant={step.status === 'completed' ? 'success' : step.status === 'in_progress' ? 'info' : 'neutral'}>
                      {step.status}
                    </Badge>
                  </li>
                ))}
              </ol> : <pre className="tx__pre">{displayText(plan)}</pre>}
            </div>
          )}
        </FoldContent>
      </Fold>
    </div>
  </DevScope>
  )
}

export default StructuredBlock
