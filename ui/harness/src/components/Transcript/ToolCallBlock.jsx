import { Badge, DevScope, Fold, FoldTrigger, FoldContent } from 'component-library'
import { errorText } from './errorText'
import { isPlanTool, planMarkdown, planView } from './plan'
import PlanMarkdown from './PlanMarkdown'

const ToolCallBlock = ({ event, renderPlanActions }) => {
  if (isPlanTool(event.name)) {
    const view = planView(event)
    const plan = planMarkdown(view)
    return (
      <DevScope id="hr7l5d3" state={{ name: event.name }}>
        <div className="tx tx--tool tx--plan">
          <Fold defaultOpen>
            <FoldTrigger>
              <div className="tx__fold-header">
                <span className="tx__fold-title">Plan Proposal</span>
                {view.status && (
                  <Badge size="small" variant={view.status === 'error' ? 'danger' : 'info'}>
                    {view.status}
                  </Badge>
                )}
              </div>
            </FoldTrigger>
            <FoldContent>
              <DevScope id="hr8n4q1">
                <PlanMarkdown plan={plan} />
              </DevScope>
              {view.error && <pre className="tx__pre tx__pre--error">{errorText(view.error)}</pre>}
              {plan && renderPlanActions && <div className="tx__plan-actions">{renderPlanActions(plan)}</div>}
            </FoldContent>
          </Fold>
        </div>
      </DevScope>
    )
  }
  return (
    <DevScope id="hr7l5d3" state={{ name: event.name }}>
      <div className="tx tx--tool">
        <Fold>
          <FoldTrigger>
            <div className="tx__fold-header">
              <span className="tx__tool-tag">⚡ Tool</span>
              <span className="tx__tool-name">{event.name || 'command'}</span>
              {event.status && (
                <Badge size="small" variant={event.status === 'error' ? 'danger' : 'neutral'}>
                  {event.status}
                </Badge>
              )}
            </div>
          </FoldTrigger>
          <FoldContent>
            {event.input && (
              <div className="tx__tool-section">
                <span className="tx__tool-label">Input</span>
                <pre className="tx__pre">{JSON.stringify(event.input, null, 2)}</pre>
              </div>
            )}
            {event.output != null && (
              <div className="tx__tool-section">
                <span className="tx__tool-label">Output</span>
                <pre className="tx__pre">{typeof event.output === 'string' ? event.output : JSON.stringify(event.output, null, 2)}</pre>
              </div>
            )}
            {event.error && (
              <div className="tx__tool-section">
                <span className="tx__tool-label tx__tool-label--error">Error</span>
                <pre className="tx__pre tx__pre--error">{errorText(event.error)}</pre>
              </div>
            )}
            {event.exitCode != null && (
              <div className="tx__tool-exit">
                <span>Exit code:</span>
                <Badge size="small" variant={event.exitCode === 0 ? 'success' : 'danger'}>
                  {event.exitCode}
                </Badge>
              </div>
            )}
          </FoldContent>
        </Fold>
      </div>
    </DevScope>
  )
}

export default ToolCallBlock
