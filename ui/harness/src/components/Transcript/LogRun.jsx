import { Fragment } from 'react'
import { Badge, DevScope } from 'component-library'
import { errorText } from './errorText'
import TextWithTables from './TextWithTables'

const LogChunk = ({ event }) => {
  switch (event.type) {
    case 'text':
      return event.text ? <TextWithTables text={event.text} /> : null
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

const LogRun = ({ events }) => (
  <div className="transcript__log">
    {events.map((event, index) => (
      <Fragment key={index}>
        <LogChunk event={event} />
      </Fragment>
    ))}
  </div>
)

export default LogRun
