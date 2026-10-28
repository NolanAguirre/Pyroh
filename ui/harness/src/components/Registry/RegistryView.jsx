import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  DevScope,
  Matrix,
  SelectDisplay,
} from 'component-library'
import api from '../../api'
import './Registry.css'

const GLOBAL = '__global'
const ANY = '__any'

const SCOPE_VARIANTS = { builtin: 'neutral', global: 'info', workspace: 'primary' }

const useExplain = (workspaceId, provider) => {
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .explainRegistry(workspaceId || null, { provider: provider || undefined }, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [workspaceId, provider, refreshToken])

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) }
}

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

const whereText = (where) => {
  const entries = Object.entries(where || {})
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : 'everywhere'
}

const whatText = (what) => Object.entries(what || {}).map(([kind, id]) => `${kind} ${id}`).join(', ')

const modeFlags = (mode) => [
  mode.terse && 'terse',
  mode.promptOptional && 'prompt optional',
  mode.newSession && 'new session',
  mode.autoName && 'auto name',
  mode.snapshot && 'snapshot',
  mode.savePlan && 'save plan',
  mode.steerable === false && 'not steerable',
  mode.instructions && 'instructions',
].filter(Boolean)

const SourcesCard = ({ sources }) => (
  <Card>
    <CardHeader>Plugins</CardHeader>
    <CardSection>
      <Matrix
        devId="r7s2n4p"
        rowDevId="r1s6k8q"
        className="registry__table"
        label="Loaded plugins"
        rowLabel="Plugin"
        rows={sources.map((source) => ({ id: `${source.scope}:${source.name}`, ...source }))}
        columns={[
          { id: 'scope', title: 'Scope' },
          { id: 'modes', title: 'Modes' },
          { id: 'file', title: 'File' },
          { id: 'status', title: 'Status' },
        ]}
        renderRowHeader={(row) => row.name}
        renderCell={(row, column) => {
          if (column.id === 'scope') return <Scope scope={row.scope} />
          if (column.id === 'modes') return row.modes.length ? row.modes.join(', ') : <span className="hint">none</span>
          if (column.id === 'file') return <FilePath file={row.file} />
          return row.error
            ? <span className="registry__error" title={row.error}>{row.error}</span>
            : <Badge size="small" variant="success">loaded</Badge>
        }}
      />
      {sources.length === 1 && <p className="hint">No global or workspace plugins found.</p>}
    </CardSection>
  </Card>
)

const RulesCard = ({ ruleSets, policies }) => (
  <Card>
    <CardHeader>Rules &amp; policies</CardHeader>
    {ruleSets.map((set) => (
      <CardSection key={set.scope}>
        <div className="registry__rules-head">
          <Scope scope={set.scope} />
          <FilePath file={set.file} />
          {set.error && <span className="registry__error" title={set.error}>{set.error}</span>}
        </div>
        {set.rules.length ? (
          <Matrix
            devId="r4u9t3w"
            rowDevId="r8v2m5e"
            className="registry__table"
            label={`${set.scope} rules`}
            rowLabel="Rule"
            rows={set.rules}
            columns={[
              { id: 'what', title: 'What' },
              { id: 'where', title: 'Where' },
              { id: 'effect', title: 'Effect' },
              { id: 'note', title: 'Note' },
            ]}
            renderRowHeader={(row) => row.id}
            renderCell={(row, column) => {
              if (column.id === 'what') return whatText(row.what)
              if (column.id === 'where') return whereText(row.where)
              if (column.id === 'effect') return <Badge size="small" variant={row.effect === 'allow' ? 'success' : 'danger'}>{row.effect}</Badge>
              return row.note || <span className="hint">—</span>
            }}
          />
        ) : (
          <p className="hint">No rules.</p>
        )}
      </CardSection>
    ))}
    <CardSection>
      <div className="registry__rules-head"><strong>Policies</strong></div>
      {policies.length ? (
        <ul className="registry__list">
          {policies.map((policy) => (
            <li key={`${policy.scope}:${policy.name}`}>
              <Scope scope={policy.scope} /> {policy.name} <FilePath file={policy.file} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No plugin policies.</p>
      )}
    </CardSection>
  </Card>
)

const ModesCard = ({ modes }) => (
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
          if (column.id === 'flags') {
            return (
              <span className="registry__chips">
                {modeFlags(row).map((flag) => <Badge key={flag} size="small">{flag}</Badge>)}
              </span>
            )
          }
          return row[column.id] || <span className="hint">—</span>
        }}
      />
    </CardSection>
  </Card>
)

const ToolsCard = ({ tools, modes }) => (
  <Card>
    <CardHeader>Tools by mode</CardHeader>
    <CardSection>
      {tools.length ? (
        <Matrix
          devId="r5t8b1n"
          rowDevId="r9t3c6j"
          className="registry__table"
          label="Tool decisions per mode"
          rowLabel="Tool"
          rows={tools}
          columns={modes.map((mode) => ({ id: mode.id, title: mode.label }))}
          renderRowHeader={(row) => (
            <span title={[row.hint, ...Object.entries(row.delivery || {}).map(([provider, how]) => `${provider}: ${how}`)].filter(Boolean).join('\n')}>
              <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
            </span>
          )}
          renderCell={(row, column) => (row.byMode[column.id] ? <Decision decision={row.byMode[column.id]} /> : '—')}
        />
      ) : (
        <p className="hint">No tools registered.</p>
      )}
    </CardSection>
  </Card>
)

const PanelsCard = ({ panels }) => (
  <Card>
    <CardHeader>Panels</CardHeader>
    <CardSection>
      <Matrix
        devId="r3p6l9a"
        rowDevId="r7p2q4z"
        className="registry__table"
        label="Registered panels"
        rowLabel="Panel"
        rows={panels}
        columns={[
          { id: 'decision', title: 'Decision' },
          { id: 'scope', title: 'Scope' },
          { id: 'placement', title: 'Placement' },
          { id: 'needsWorkspace', title: 'Needs workspace' },
        ]}
        renderRowHeader={(row) => (
          <span title={row.title || undefined}>
            <strong>{row.label}</strong> <code className="registry__id">{row.id}</code>
          </span>
        )}
        renderCell={(row, column) => {
          if (column.id === 'decision') return <Decision decision={row.decision} />
          if (column.id === 'scope') return <Scope scope={row.scope} />
          if (column.id === 'needsWorkspace') return row.needsWorkspace ? 'yes' : 'no'
          return row[column.id]
        }}
      />
    </CardSection>
  </Card>
)

const RegistryView = ({ devId, workspaces = [], providers = [], workspaceId = null, onBack }) => {
  const [scope, setScope] = useState(workspaceId || GLOBAL)
  const [provider, setProvider] = useState(ANY)
  const { data, error, loading, refresh } = useExplain(scope === GLOBAL ? null : scope, provider === ANY ? null : provider)

  const scopeOptions = [
    { value: GLOBAL, displayValue: 'Global (no workspace)' },
    ...workspaces.map((item) => ({ value: item.id, displayValue: item.name })),
  ]
  const providerOptions = [
    { value: ANY, displayValue: 'Any provider' },
    ...providers.map((item) => ({ value: item.id, displayValue: item.id })),
  ]

  return (
    <DevScope id={devId} state={{ scope, provider, loading }}>
      <div className="registry">
        <header className="registry__topbar">
          <Button devId="r4k7h2s" variant="secondary" size="sm" onClick={onBack}>
            ← Sessions
          </Button>
          <strong className="registry__title">Registry</strong>
          <div className="registry__filters">
            <SelectDisplay className="registry__select" aria-label="Workspace" selected={scope} options={scopeOptions} select={setScope} />
            <SelectDisplay className="registry__select" aria-label="Provider" selected={provider} options={providerOptions} select={setProvider} />
            <Button devId="r2w5y8g" variant="secondary" size="sm" onClick={refresh} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
        </header>

        <main className="registry__body">
          {error && <p className="registry__error">{error}</p>}
          {!data && !error && <p className="hint">Loading registry…</p>}
          {data && (
            <>
              {data.workspace && (
                <p className="hint">
                  {data.workspace.name} · <code>{data.workspace.cwd}</code>
                </p>
              )}
              <div className="registry__grid">
                <SourcesCard sources={data.sources} />
                <RulesCard ruleSets={data.rules} policies={data.policies} />
              </div>
              <ModesCard modes={data.modes} />
              <ToolsCard tools={data.tools} modes={data.modes} />
              <PanelsCard panels={data.panels} />
              <p className="hint">Hover a decision to see what decided it.</p>
            </>
          )}
        </main>
      </div>
    </DevScope>
  )
}

export default RegistryView
