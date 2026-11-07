import { Fragment } from 'react'
import { Badge, DevScope } from 'component-library'
import { errorText } from './errorText'
import TextWithTables from './TextWithTables'
import MessageFiles from './MessageFiles'

const LogChunk = ({ event, workspaceId, onOpenFile }) => {
  switch (event.type) {
    case 'question_message':
      return (
        <div className="transcript__question">
          <strong>Agent question</strong>
          <TextWithTables text={event.text || ''} />
        </div>
      )
    case 'text':
      return event.text ? (
        <div>
          {event.finalReply && onOpenFile && <MessageFiles text={event.text} workspaceId={workspaceId} onOpenFile={onOpenFile} />}
          <TextWithTables text={event.text} />
        </div>
      ) : null
    case 'thinking':
      return event.text ? (
        <DevScope id="hr0b2y7">
          <div className="transcript__thinking-block">
            <span className="transcript__thinking-tag">Thinking:</span>
            <span className="transcript__thinking">{event.text}</span>
          </div>
        </DevScope>
      ) : null
    case 'status':
      return (
        <div className="transcript__status-pill">
          <Badge size="small" variant="neutral">{event.status}</Badge>
        </div>
      )
    case 'result': {
      const failed = event.status === 'error'
      const message = errorText(event.error || event.message)
      if (failed || message) {
        return (
          <div className="transcript__alert transcript__alert--error">
            <span className="transcript__alert-icon">⚠</span>
            <span>{message || `Run ${event.status}`}</span>
          </div>
        )
      }
      return (
        <div className="transcript__status-pill">
          <Badge size="small" variant="success">Run {event.status}</Badge>
        </div>
      )
    }
    case 'handoff':
      return (
        <div className="transcript__status-pill">
          <Badge size="small" variant="info">Continued in new session {event.session?.id}</Badge>
        </div>
      )
    case 'error':
      return (
        <div className="transcript__alert transcript__alert--error">
          <span className="transcript__alert-icon">⚠</span>
          <span>{errorText(event.message || event.error) || 'Unknown error'}</span>
        </div>
      )
    default:
      return null
  }
}

const LogRun = ({ events, workspaceId, onOpenFile }) => (
  <div className="transcript__log">
    {events.map((event, index) => (
      <Fragment key={index}>
        <LogChunk event={event} workspaceId={workspaceId} onOpenFile={onOpenFile} />
      </Fragment>
    ))}
  </div>
)

export default LogRun
