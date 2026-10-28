import { Fragment, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge, Button, DevScope, Fold, FoldTrigger, FoldContent } from 'component-library'

// Item IDs belong to a provider turn. Merge replayed deltas exactly as live ones,
// and replace them with the authoritative completed item when it arrives.
const transcriptItems = (events) => {
  const rows = []
  const byId = new Map()
  for (const event of events) {
    if (event.type === 'usage' || event.type === 'context' || event.type === 'question') continue
    if (!event.itemId) {
      const last = rows[rows.length - 1]
      if ((event.type === 'text' || event.type === 'thinking') && last && !last.itemId
        && last.type === event.type && last.runId === event.runId) {
        rows[rows.length - 1] = { ...last, text: (last.text || '') + (event.text || '') }
      } else rows.push(event)
      continue
    }
    const key = `${event.runId}:${event.type}:${event.itemId}`
    const index = byId.get(key)
    const previous = index === undefined ? {} : rows[index]
    const next = { ...previous, ...Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) }
    if (event.delta) next.text = (previous.text || '') + (event.text || '')
    if (event.outputDelta !== undefined) next.output = (previous.output || '') + event.outputDelta
    if (index === undefined) {
      byId.set(key, rows.length)
      rows.push(next)
    } else rows[index] = next
  }
  return rows
}

const errorText = (value) => {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if (typeof value.message === 'string' && value.message) return value.message
    if (typeof value.error === 'string' && value.error) return value.error
    try {
      const json = JSON.stringify(value)
      if (json && json !== '{}' && json !== 'null') return json
    } catch {
      // ignore
    }
  }
  return String(value)
}

const asObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Cursor presents a plan with createPlan. Claude exits plan mode with ExitPlanMode.
const PLAN_TOOLS = new Set(['createplan', 'exitplanmode'])
const HARNESS_PLAN_STOP = 'The harness recorded this plan. Stop now without implementing it.'

const isPlanTool = (name) => PLAN_TOOLS.has(String(name || '').toLowerCase())

const planMarkdown = (event) => {
  const input = asObject(event.input)
  if (typeof input?.plan === 'string') return input.plan
  const output = asObject(event.output)
  if (typeof output?.plan === 'string') return output.plan
  if (typeof output?.value?.plan === 'string') return output.value.plan
  return ''
}

// Denying ExitPlanMode stops Claude from implementing. That bookkeeping is not a failed plan.
const planView = (event) => {
  const stopped = event.error === HARNESS_PLAN_STOP || event.output === HARNESS_PLAN_STOP
  if (!stopped) return event
  return { ...event, status: 'completed', error: undefined }
}

const isBlock = (event) => event.type === 'tool_call' || event.type === 'plan' || event.type === 'diff' || event.type === 'user'

const userEvents = (runs) => runs.flatMap((run) => {
  if (typeof run.prompt !== 'string' || run.prompt === '') return []
  return [{ type: 'user', text: run.prompt, runId: run.id, ts: run.startedAt || 0, itemId: `user:${run.id}` }]
})

const hideRecordedPlanText = (events) => {
  const runsWithPlan = new Set()
  for (const event of events) {
    if (event.type === 'tool_call' && isPlanTool(event.name)) runsWithPlan.add(event.runId)
  }
  return events.filter((event) => {
    if (event.type !== 'text' || !runsWithPlan.has(event.runId)) return true
    return !String(event.itemId || '').endsWith(':plan')
  })
}

const fenceLine = (line) => /^\s*(```|~~~)/.test(line)

const isSeparatorRow = (line) => /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(line)

const isTableRow = (line) => {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return body.split('|').length >= 2
}

const splitMarkdownTables = (text) => {
  const lines = String(text).split('\n')
  const parts = []
  let buffer = []
  let inFence = false

  const flush = () => {
    if (!buffer.length) return
    parts.push({ kind: 'text', text: buffer.join('\n') })
    buffer = []
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, '')
    if (fenceLine(line)) {
      inFence = !inFence
      buffer.push(line)
      index += 1
      continue
    }
    const next = lines[index + 1]?.replace(/\r$/, '')
    if (!inFence && next !== undefined && isTableRow(line) && isSeparatorRow(next)) {
      flush()
      const table = [line, next]
      index += 2
      while (index < lines.length) {
        const row = lines[index].replace(/\r$/, '')
        if (fenceLine(row) || !isTableRow(row) || isSeparatorRow(row)) break
        table.push(row)
        index += 1
      }
      parts.push({ kind: 'table', text: table.join('\n') })
      continue
    }
    buffer.push(line)
    index += 1
  }
  flush()
  return parts
}

const TextWithTables = ({ text }) => {
  const parts = splitMarkdownTables(text)
  if (!parts.some((part) => part.kind === 'table')) {
    return <span className="transcript__text">{text}</span>
  }
  return (
    <div className="transcript__text">
      {parts.map((part, index) => (
        part.kind === 'table'
          ? (
            <div key={index} className="transcript__table">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          )
          : <span key={index}>{part.text}</span>
      ))}
    </div>
  )
}

const logParts = (events) => {
  const parts = []
  for (const event of events) {
    if (isBlock(event)) {
      parts.push({ kind: 'block', event })
      continue
    }
    const last = parts[parts.length - 1]
    if (last && last.kind === 'log') last.events.push(event)
    else parts.push({ kind: 'log', events: [event] })
  }
  return parts
}

const PlanMarkdown = ({ plan }) => {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    if (!plan) return
    navigator.clipboard?.writeText(plan).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  if (!plan) return <p className="hint">Writing plan…</p>

  return (
    <div className="tx__markdown-wrap">
      <div className="tx__markdown-actions">
        <Button
          variant={raw ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={raw}
          onClick={() => setRaw((on) => !on)}
          devId="hr3k8m2"
        >
          Raw
        </Button>
        <Button variant="ghost" size="sm" onClick={copy} devId="hr6p1w4">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {raw
        ? <pre className="tx__pre tx__markdown-raw">{plan}</pre>
        : (
          <div className="tx__markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
          </div>
        )}
    </div>
  )
}

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

const UserMessage = ({ event }) => (
  <DevScope id="hr9k4u2" state={{ runId: event.runId }}>
    <div className="tx tx--user">
      <div className="tx__user-header">
        <span className="tx__user-tag">You</span>
        {event.steer && <span className="tx__steer-tag">Steer</span>}
      </div>
      <div className="tx__user-body">{event.text}</div>
    </div>
  </DevScope>
)

const renderPart = (renderPlanActions) => (part, index) => {
  if (part.kind === 'log') return <LogRun key={index} events={part.events} />
  const { event } = part
  if (event.type === 'user') return <UserMessage key={index} event={event} />
  if (event.type === 'tool_call') return <ToolCallBlock key={index} event={event} renderPlanActions={renderPlanActions} />
  return <StructuredBlock key={index} event={event} />
}

const Transcript = ({ devId, events, runs = [], renderPlanActions, fontSize }) => {
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
    return logParts(hideRecordedPlanText(items))
  }, [events, runs])

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
