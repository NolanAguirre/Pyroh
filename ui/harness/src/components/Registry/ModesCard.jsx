import {
  Badge,
  Card,
  CardHeader,
  CardSection,
  Matrix,
} from 'component-library'
import { Decision, Scope } from './shared'

const modeFlags = (flags, mode) => flags.filter((flag) => flag.modes.includes(mode.id))

const providerLabels = { cursor: 'Cursor', claude: 'Claude', codex: 'Codex', grok: 'Grok' }

const ProviderModes = ({ providerModes = {} }) => {
  const implementations = Object.entries(providerModes)
  if (!implementations.length) return <span className="hint">—</span>

  return (
    <div className="registry__mode-providers">
      {implementations.map(([provider, implementation]) => (
        <div key={provider} className="registry__mode-provider">
          <strong>{providerLabels[provider] || provider}</strong>
          {implementation.description && <p className="hint">{implementation.description}</p>}
          <dl>
            <dt>Native mode</dt>
            <dd><code>{implementation.nativeMode || '—'}</code></dd>
            <dt>Prompts</dt>
            <dd>
              {implementation.prompts?.length ? (
                <span className="registry__chips">
                  {implementation.prompts.map((prompt) => <code key={prompt}>{prompt}</code>)}
                </span>
              ) : <span className="hint">None</span>}
            </dd>
            <dt>Tools</dt>
            <dd>
              {Object.keys(implementation.tools || {}).length ? (
                Object.entries(implementation.tools).map(([policy, value]) => (
                  <div key={policy}>
                    <code>{policy}</code>: <code>{typeof value === 'string' ? value : JSON.stringify(value)}</code>
                  </div>
                ))
              ) : <span className="hint">—</span>}
            </dd>
            {implementation.approvalPolicy && <>
              <dt>Approval</dt>
              <dd><code>{implementation.approvalPolicy}</code></dd>
            </>}
            {implementation.sandbox && <>
              <dt>Sandbox</dt>
              <dd><code>{implementation.sandbox}</code></dd>
            </>}
          </dl>
        </div>
      ))}
    </div>
  )
}

const ModesCard = ({ modes, flags, onFlags }) => (
  <Card>
    <CardHeader>Modes</CardHeader>
    <CardSection>
      <Matrix
        devId="r2m7d4c"
        rowDevId="r6m1f9h"
        className="registry__table"
        label="Registered modes"
        rowLabel="Mode"
        rows={modes}
        columns={[
          { id: 'decision', title: 'Decision' },
          { id: 'scope', title: 'Scope' },
          { id: 'kind', title: 'Kind' },
          { id: 'base', title: 'Base' },
          { id: 'tools', title: 'Tools' },
          { id: 'providerModes', title: 'Provider implementations' },
          { id: 'flags', title: 'Flags' },
        ]}
        renderRowHeader={(row) => (
          <span title={row.hint || undefined}>
            <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
            {row.shadows && <span className="hint"> shadows {row.shadows}</span>}
          </span>
        )}
        renderCell={(row, column) => {
          if (column.id === 'decision') return <Decision decision={row.decision} />
          if (column.id === 'scope') return <span title={row.file || undefined}><Scope scope={row.scope} /> {row.source}</span>
          if (column.id === 'tools') return row.tools?.length ? row.tools.join(', ') : <span className="hint">—</span>
          if (column.id === 'providerModes') return <ProviderModes providerModes={row.providerModes} />
          if (column.id === 'flags') {
            return (
              <span className="registry__chips">
                {modeFlags(flags, row).map((flag) => (
                  <button key={flag.id} type="button" className="registry__flag-link" title={flag.description} onClick={onFlags}>
                    <Badge size="small">{flag.label}</Badge>
                  </button>
                ))}
              </span>
            )
          }
          return row[column.id] || <span className="hint">—</span>
        }}
      />
    </CardSection>
  </Card>
)

export default ModesCard
