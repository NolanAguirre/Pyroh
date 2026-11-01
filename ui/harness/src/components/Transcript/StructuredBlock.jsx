import { Badge, DevScope, Fold, FoldTrigger, FoldContent } from 'component-library'

const StructuredBlock = ({ event }) => (
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
              {event.explanation && <p className="tx__plan-expl">{event.explanation}</p>}
              <ol className="tx__plan-list">
                {(event.plan || []).map((step, i) => (
                  <li key={i} className="tx__plan-step">
                    <span className="tx__plan-step-text">{step.step}</span>
                    <Badge size="small" variant={step.status === 'completed' ? 'success' : step.status === 'in_progress' ? 'info' : 'neutral'}>
                      {step.status}
                    </Badge>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </FoldContent>
      </Fold>
    </div>
  </DevScope>
)

export default StructuredBlock
