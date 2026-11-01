import { useState } from 'react'
import { DevScope } from 'component-library'
import api from '../../api'
import { urlWithSelection } from '../../appUrl'

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const dependencySessionId = (event) => {
  const sessionId = event.runAfter?.sessionId
  if (!sessionId) return ''
  if (!event.viewerSessionId) return sessionId
  return api.adoptSession(event.viewerSessionId, { id: sessionId }).id
}

const loadSessionHref = (event) => {
  const sessionId = dependencySessionId(event)
  if (!sessionId || !event.workspaceId) return ''
  return urlWithSelection(new URL(window.location.href), event.workspaceId, sessionId, null, null, null).href
}

const UserMessage = ({ event }) => {
  const [copied, setCopied] = useState(false)
  const dependency = event.runAfter
  const text = event.text || dependency?.prompt || ''
  const copyText = text
  const href = dependency ? loadSessionHref(event) : ''

  const copy = () => {
    if (!copyText) return
    navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <DevScope id="hr9k4u2" state={{ runId: event.runId, queued: Boolean(dependency) }}>
      <div className="tx tx--user">
        <div className="tx__user-header">
          <span className="tx__user-tag">You</span>
          {event.steer && <span className="tx__steer-tag">Steer</span>}
          {dependency && <span className="tx__steer-tag">Queued</span>}
          <DevScope id="k3w8n1p">
            <button
              type="button"
              className="tx__user-copy"
              aria-label={copied ? 'Copied' : 'Copy message'}
              title={copied ? 'Copied' : 'Copy'}
              onClick={copy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </DevScope>
        </div>
        <div className="tx__user-body">{text}</div>
        {dependency && (
          <div className="tx__user-after">
            <span className="tx__user-after-label">
              After {dependency.sessionTitle || dependency.sessionId || 'session'}
            </span>
            {href ? (
              <DevScope id="l5s8n2q" state={{ session: dependencySessionId(event) }}>
                <a className="tx__user-after-load" href={href}>Load session</a>
              </DevScope>
            ) : null}
          </div>
        )}
      </div>
    </DevScope>
  )
}

export default UserMessage
