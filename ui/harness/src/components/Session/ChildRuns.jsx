import { useState } from 'react'
import { Badge, Card, CardHeader, CardSection, DevScope, Matrix } from 'component-library'
import QuestionCard from '../QuestionCard'
import api from '../../api'
import { urlWithSelection } from '../../appUrl'
import { formatDuration, formatNumber } from '../../format'

const STATUS_VARIANT = {
  idle: 'neutral',
  running: 'info',
  starting: 'info',
  awaiting_input: 'warning',
  paused: 'warning',
  disconnected: 'danger',
  stopped: 'neutral',
  finished: 'success',
  completed: 'success',
  cancelled: 'neutral',
  error: 'danger',
  queued: 'info',
  subagent: 'info',
}

const liveState = (state) => state === 'running' || state === 'starting' || state === 'awaiting_input' || state === 'subagent'

const childLabel = (child) => {
  if (child.name) return child.name
  if (child.childKind !== 'workflow') return `Agent · ${child.runId || child.sessionId || 'Spawn failed'}`
  const step = child.workflow?.step
  const label = step ? step.charAt(0).toUpperCase() + step.slice(1) : 'Workflow step'
  return child.workflow?.phase ? `Phase ${child.workflow.phase}: ${label}` : label
}

const ChildRuns = ({ devId, session, runs, children }) => {
  const [open, setOpen] = useState(true)
  if (!children.length) return null
  const direct = runs.reduce((sum, run) => {
    const usage = run.usage
    if (!usage) return sum
    const input = usage.inputTokens ?? usage.input_tokens ?? usage.input ?? 0
    const output = usage.outputTokens ?? usage.output_tokens ?? usage.output ?? 0
    return sum + (session.provider === 'cursor' ? input + output : usage.totalTokens ?? usage.total_tokens ?? usage.total ?? input + output)
  }, 0)
  const childTokens = children.reduce((sum, child) => sum + (child.normalizedUsage?.total || 0), 0)
  const link = (child) => urlWithSelection(new URL(window.location.href), child.workspaceId || session.workspaceId, child.sessionId, null, null, null).href
  return (
    <DevScope id={devId} state={{ session: session.id, count: children.length, open }}>
      <Card>
        <CardHeader open={open} onToggle={() => setOpen((prev) => !prev)}>
          <span className="child-runs__title">Child runs ({children.length})</span>
          {!open && (
            <span className="child-runs__badges">
              {children.map((child, index) => {
                const variant = STATUS_VARIANT[child.state] || 'neutral'
                const label = childLabel(child)
                return (
                  <Badge
                    key={child.runId || child.sessionId || index}
                    size="small"
                    variant={variant}
                    title={`${label} · ${child.state || 'unknown'}`}
                    addClassName="child-runs__badge"
                  >
                    <Badge
                      size="small"
                      variant={variant}
                      dot
                      addClassName={`session-row__status-dot${liveState(child.state) ? ' session-row__status-dot--live' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="child-runs__badge-name">{label}</span>
                  </Badge>
                )
              })}
            </span>
          )}
        </CardHeader>
        {open && <CardSection>
          <p className="hint">Reported tokens: parent {formatNumber(direct)} · children {formatNumber(childTokens)} · combined {formatNumber(direct + childTokens)}</p>
          {runs.filter(run => children.some(child => child.parentRunId === run.id)).map(run => (
            <DevScope key={run.id} id="lewycwc" state={{ run: run.id }}>
              <div>
                <Matrix
                  devId="23bx776"
                  rowDevId="4d28gqi"
                  colDevId="bbfh0z8"
                  className="child-runs__matrix"
                  label={`Children of ${run.id}`}
                  rowLabel={`Parent run ${run.id}`}
                  rows={children.filter(child => child.parentRunId === run.id).map((child, index) => ({ ...child, id: child.runId || `pending-${index}` }))}
                  columns={[{ id: 'kind', title: 'Kind' }, { id: 'state', title: 'Status' }, { id: 'model', title: 'Provider / model' }, { id: 'durationMs', title: 'Duration' }, { id: 'tokens', title: 'Reported tokens' }]}
                  renderRowHeader={child => child.sessionId ? <a href={link(child)} title="Open child transcript">{childLabel(child)}</a> : `${childLabel(child)} · Spawn failed`}
                  renderCell={(child, column) => column.id === 'kind' ? child.childKind === 'workflow' ? 'Workflow step' : 'Agent subagent'
                    : column.id === 'model' ? `${child.provider || ''} / ${child.model || 'default'}`
                    : column.id === 'durationMs' ? formatDuration(child.durationMs)
                      : column.id === 'tokens' ? child.normalizedUsage ? formatNumber(child.normalizedUsage.total) : 'Not reported' : child.state}
                />
                {children.filter(child => child.parentRunId === run.id).map((child, index) => (
                  <div key={child.runId || `pending-${index}`}>
                    {child.error && <p className="hint hint--error">{child.error}</p>}
                    {(child.pendingQuestions || []).map(question => (
                      <QuestionCard key={question.id} devId="d90b43g" question={{ ...question, question: `${childLabel(child)}: ${question.question}` }}
                        onAnswer={(qid, value) => api.answerQuestion(child.sessionId, qid, value)} />
                    ))}
                  </div>
                ))}
              </div>
            </DevScope>
          ))}
        </CardSection>}
      </Card>
    </DevScope>
  )
}

export default ChildRuns
