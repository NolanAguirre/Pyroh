import { useState } from 'react'
import { DevScope } from 'component-library'

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

const UserMessage = ({ event }) => {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    const text = event.text || ''
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <DevScope id="hr9k4u2" state={{ runId: event.runId }}>
      <div className="tx tx--user">
        <div className="tx__user-header">
          <span className="tx__user-tag">You</span>
          {event.steer && <span className="tx__steer-tag">Steer</span>}
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
        <div className="tx__user-body">{event.text}</div>
      </div>
    </DevScope>
  )
}

export default UserMessage
