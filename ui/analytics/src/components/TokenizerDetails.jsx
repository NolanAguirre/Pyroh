import { Badge } from '../common/Primitives.jsx'

export const TokenizerDetails = ({ identity }) => {
  return <div className="detail"><div className="row"><strong>{identity.model || 'Unknown model'}</strong><Badge tone={identity.approximation || identity.unavailable ? 'warning' : 'neutral'}>{identity.unavailable ? 'Tokenizer unavailable' : identity.approximation ? 'Proxy tokenizer' : 'Mapped tokenizer'}</Badge></div><dl className="key-value"><dt>Package</dt><dd>{identity.package} {identity.version || 'Unknown version'}</dd><dt>Encoding</dt><dd>{identity.encoding}</dd><dt>Input serialization</dt><dd className="monospace">{identity.serialization}</dd></dl><p className="muted">{identity.reason}</p>{identity.unavailable && <p className="alert alert--warning">{identity.unavailable}</p>}</div>
}
