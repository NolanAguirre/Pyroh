import { Card, CardHeader, CardSection, Matrix } from 'component-library'
import QuestionCard from '../QuestionCard'
import api from '../../api'
import { urlWithSelection } from '../../appUrl'
import { formatDuration, formatNumber } from '../../format'

const ChildRuns = ({ session, runs, children }) => {
  if (!children.length) return null
  const direct = runs.reduce((sum, run) => {
    const usage = run.usage
    if (!usage) return sum
    const input = usage.inputTokens ?? usage.input_tokens ?? usage.input ?? 0
    const output = usage.outputTokens ?? usage.output_tokens ?? usage.output ?? 0
    return sum + (session.provider === 'cursor' ? input + output : usage.totalTokens ?? usage.total_tokens ?? usage.total ?? input + output)
  }, 0)
  const childTokens = children.reduce((sum, child) => sum + (child.normalizedUsage?.total || 0), 0)
  const link = (child) => urlWithSelection(new URL(window.location.href), child.workspaceId, child.sessionId, null, null, null).href
  return (
    <Card>
      <CardHeader>Child runs ({children.length})</CardHeader>
      <CardSection>
        <p className="hint">Reported tokens: parent {formatNumber(direct)} · children {formatNumber(childTokens)} · combined {formatNumber(direct + childTokens)}</p>
        {runs.filter(run => children.some(child => child.parentRunId === run.id)).map(run => (
          <div key={run.id}>
            <Matrix
              label={`Children of ${run.id}`}
              rowLabel={`Parent run ${run.id}`}
              rows={children.filter(child => child.parentRunId === run.id).map((child, index) => ({ ...child, id: child.runId || `pending-${index}` }))}
              columns={[{ id: 'state', title: 'Status' }, { id: 'model', title: 'Provider / model' }, { id: 'durationMs', title: 'Duration' }, { id: 'tokens', title: 'Reported tokens' }]}
              renderRowHeader={child => child.sessionId ? <a href={link(child)}>Transcript · {child.runId || child.sessionId}</a> : 'Spawn failed'}
              renderCell={(child, column) => column.id === 'model' ? `${child.provider || ''} / ${child.model || 'default'}`
                : column.id === 'durationMs' ? formatDuration(child.durationMs)
                  : column.id === 'tokens' ? child.normalizedUsage ? formatNumber(child.normalizedUsage.total) : 'Not reported' : child.state}
            />
            {children.filter(child => child.parentRunId === run.id).map((child, index) => (
              <div key={child.runId || `pending-${index}`}>
                {child.error && <p className="hint hint--error">{child.error}</p>}
                {(child.pendingQuestions || []).map(question => (
                  <QuestionCard key={question.id} question={{ ...question, question: `Child ${child.runId}: ${question.question}` }}
                    onAnswer={(qid, value) => api.answerQuestion(child.sessionId, qid, value)} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </CardSection>
    </Card>
  )
}

export default ChildRuns
