import { useMemo } from 'react'
import { DevScope } from 'component-library'
import { errorText } from './Transcript/errorText'
import { hideRecordedPlanText, logParts, transcriptItems, userEvents } from './Transcript/items'
import LogRun from './Transcript/LogRun'
import StructuredBlock from './Transcript/StructuredBlock'
import ToolCallBlock from './Transcript/ToolCallBlock'
import UserMessage from './Transcript/UserMessage'

const markQueued = (items, queued, workspaceId, viewerSessionId) => {
  if (!queued) return items
  const extra = { runAfter: queued, workspaceId, viewerSessionId }
  const index = items.findIndex((event) => event.type === 'user')
  if (index === -1) {
    return [{
      type: 'user',
      text: '',
      runId: queued.runId,
      ts: 0,
      itemId: 'user:queued',
      ...extra,
    }, ...items]
  }
  return items.map((event, itemIndex) => (itemIndex === index ? { ...event, ...extra } : event))
}

const renderPart = (renderPlanActions) => (part, index) => {
  if (part.kind === 'log') return <LogRun key={index} events={part.events} />
  const { event } = part
  if (event.type === 'user') return <UserMessage key={index} event={event} />
  if (event.type === 'tool_call') return <ToolCallBlock key={index} event={event} renderPlanActions={renderPlanActions} />
  return <StructuredBlock key={index} event={event} />
}

const Transcript = ({ devId, events, runs = [], renderPlanActions, fontSize, queued = null, workspaceId, viewerSessionId }) => {
  const visible = useMemo(() => {
    const missing = runs.flatMap((run) => {
      const message = errorText(run.error || run.transcriptError)
        || (['error', 'interrupted', 'disconnected'].includes(run.status) ? `Run ${run.status}` : '')
      if (!message || events.some((event) => event.runId === run.id
        && ['error', 'result'].includes(event.type)
        && errorText(event.error || event.message) === message)) return []
      return [{ type: 'result', runId: run.id, status: run.status, error: message, ts: run.endedAt || run.startedAt }]
    })
    const items = transcriptItems([...events, ...missing, ...userEvents(runs)].sort((a, b) => (a.ts || 0) - (b.ts || 0)))
    return logParts(markQueued(hideRecordedPlanText(items), queued, workspaceId, viewerSessionId))
  }, [events, runs, queued, workspaceId, viewerSessionId])

  return (
    <DevScope id={devId}>
      <div
        className="transcript"
        style={Number.isInteger(fontSize) ? { '--transcript-font-size': `${fontSize}px` } : undefined}
      >
        {visible.length === 0 && (
          <div className="transcript__empty">
            <div className="transcript__empty-icon">💬</div>
            <h3>No activity in this session yet</h3>
            <p className="hint">Choose a mode below and submit a prompt to begin working.</p>
          </div>
        )}
        {visible.map(renderPart(renderPlanActions))}
      </div>
    </DevScope>
  )
}

export default Transcript
