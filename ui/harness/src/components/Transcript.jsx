import { useMemo } from 'react'
import { DevScope } from 'component-library'
import { errorText } from './Transcript/errorText'
import { detectAutomaticPlans, hideRecordedPlanText, logParts, markFinalReplies, questionEvents, transcriptItems, userEvents, withProviderPrompts } from './Transcript/items'
import LogRun from './Transcript/LogRun'
import StructuredBlock from './Transcript/StructuredBlock'
import ToolCallBlock from './Transcript/ToolCallBlock'
import UserMessage from './Transcript/UserMessage'
import MessageFiles from './Transcript/MessageFiles'

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

const renderPart = (renderPlanActions, viewerSessionId, workspaceId, onOpenFile) => (part, index) => {
  if (part.kind === 'log') return <LogRun key={index} events={part.events} workspaceId={workspaceId} onOpenFile={onOpenFile} />
  const { event } = part
  if (event.type === 'user') return <UserMessage key={index} event={event} sessionId={viewerSessionId} />
  if (event.type === 'tool_call') return (
    <div key={index}>
      {event.finalReply && onOpenFile && <MessageFiles text={event.text} workspaceId={workspaceId} onOpenFile={onOpenFile} />}
      <ToolCallBlock event={event} renderPlanActions={renderPlanActions} />
    </div>
  )
  return <StructuredBlock key={index} event={event} />
}

const Transcript = ({ devId, events, runs = [], questions = [], renderPlanActions, fontSize, queued = null, workspaceId, viewerSessionId, onOpenFile }) => {
  const visible = useMemo(() => {
    const missing = runs.flatMap((run) => {
      const message = errorText(run.error || run.transcriptError)
        || (['error', 'interrupted', 'disconnected'].includes(run.status) ? `Run ${run.status}` : '')
      if (!message || events.some((event) => event.runId === run.id
        && ['error', 'result'].includes(event.type)
        && errorText(event.error || event.message) === message)) return []
      return [{ type: 'result', runId: run.id, status: run.status, error: message, ts: run.endedAt || run.startedAt }]
    })
    const items = transcriptItems([...events, ...missing, ...userEvents(runs), ...questionEvents(questions)].sort((a, b) => (a.ts || 0) - (b.ts || 0)))
    return logParts(markQueued(detectAutomaticPlans(markFinalReplies(hideRecordedPlanText(withProviderPrompts(items)), runs), runs), queued, workspaceId, viewerSessionId))
  }, [events, runs, questions, queued, workspaceId, viewerSessionId])

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
        {visible.map(renderPart(renderPlanActions, viewerSessionId, workspaceId, onOpenFile))}
      </div>
    </DevScope>
  )
}

export default Transcript
