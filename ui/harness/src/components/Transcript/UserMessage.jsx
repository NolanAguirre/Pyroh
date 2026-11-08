import { useState } from 'react'
import { DevScope } from 'component-library'
import api from '../../api'
import { urlWithSelection } from '../../appUrl'
import ProviderPrompt from './ProviderPrompt'
import SessionImagePreviews from '../Session/SessionImagePreviews'

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

const UserMessage = ({ event, sessionId }) => {
  const [copied, setCopied] = useState(false)
  const [whole, setWhole] = useState(false)
  const dependency = event.runAfter
  const text = event.text || dependency?.prompt || ''
  const captured = event.providerPrompt
  const copyText = captured ? captured.text : text
  const href = dependency ? loadSessionHref(event) : ''

  const copy = () => {
    if (!copyText) return
    navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <DevScope id="hr9k4u2" state={{ runId: event.runId, queued: Boolean(dependency), captured: Boolean(captured), whole, answer: Boolean(event.answer), steer: Boolean(event.steer) }}>
      <div className="tx tx--user">
        <div className="tx__user-header">
          <span className="tx__user-tag">{captured ? 'Agent prompt' : 'You'}</span>
          {captured && <span className="tx__steer-tag">Exact input</span>}
          {event.answer && <span className="tx__steer-tag">Answer</span>}
          {event.steer && <span className="tx__steer-tag">Steer</span>}
          {dependency && <span className="tx__steer-tag">Queued</span>}
          <span className="tx__user-actions">
            {captured && (
              <DevScope id="w4n8k2p" state={{ whole }}>
                <button
                  type="button"
                  className={`tx__user-whole${whole ? ' tx__user-whole--on' : ''}`}
                  aria-pressed={whole}
                  onClick={() => setWhole((value) => !value)}
                >
                  {whole ? 'By source' : 'See full prompt'}
                </button>
              </DevScope>
            )}
            <DevScope id="k3w8n1p" state={{ copied }}>
              <button
                type="button"
                className="tx__user-copy"
                aria-label={copied ? 'Copied' : captured ? 'Copy exact agent prompt' : 'Copy message'}
                title={copied ? 'Copied' : captured ? 'Copy exact agent prompt' : 'Copy'}
                onClick={copy}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </DevScope>
          </span>
        </div>
        {captured ? <ProviderPrompt prompt={captured} devId="md9l4wi" plain={whole} /> : <div className="tx__user-body">{text}</div>}
        <SessionImagePreviews images={event.images || captured?.images || dependency?.images} sessionId={sessionId || event.viewerSessionId} />
        {!captured && !dependency && (event.runPrompt || event.steer) && (
          <DevScope id="8yxr6ek" state={{ runPrompt: Boolean(event.runPrompt) }}>
            <p className="tx__prompt-note">Saved message. The full agent prompt has not been captured.</p>
          </DevScope>
        )}
        {dependency && (
          <DevScope id="qb25om0" state={{ session: dependency.sessionId || '', load: Boolean(href) }}>
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
          </DevScope>
        )}
      </div>
    </DevScope>
  )
}

export default UserMessage
