import { Badge } from 'component-library'

const SCOPE_VARIANTS = { builtin: 'neutral', global: 'info', workspace: 'primary' }

const Scope = ({ scope }) => (
  <Badge size="small" variant={SCOPE_VARIANTS[scope] || 'neutral'}>{scope}</Badge>
)

const decisionTitle = (decision) => [
  decision.reason,
  decision.rule && `rule: ${decision.rule}`,
  decision.source && `policy: ${decision.source}`,
  decision.file,
  decision.overridden && `overrode: ${decision.overridden.effect} (${decision.overridden.reason})`,
].filter(Boolean).join('\n')

const Decision = ({ decision }) => (
  <span className="registry__decision" title={decisionTitle(decision)}>
    <Badge size="small" variant={decision.effect === 'allow' ? 'success' : 'danger'}>{decision.effect}</Badge>
    <span className="registry__by">{decision.by}</span>
  </span>
)

const FilePath = ({ file }) => (file ? <code className="registry__file" title={file}>{file}</code> : <span className="hint">—</span>)

export { Scope, Decision, FilePath }
