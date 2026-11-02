import { useState } from 'react'
import {
  Button,
  DevScope,
  SelectDisplay,
  Tab,
  TabList,
  TabsDisplay,
} from 'component-library'
import FlagsView from './FlagsView'
import ModesCard from './ModesCard'
import PanelsCard from './PanelsCard'
import PromptsView from './PromptsView'
import RulesCard from './RulesCard'
import SourcesCard from './SourcesCard'
import ToolsCard from './ToolsCard'
import useExplain from './useExplain'
import './Registry.css'

const GLOBAL = '__global'
const ANY = '__any'

const SECTIONS = ['Overview', 'Flags', 'Prompts']
const FLAGS_TAB = SECTIONS.indexOf('Flags')
const PROMPTS_TAB = SECTIONS.indexOf('Prompts')

const RegistryView = ({ devId, workspaces = [], providers = [], workspaceId = null, onBack }) => {
  const [scope, setScope] = useState(workspaceId || GLOBAL)
  const [provider, setProvider] = useState(ANY)
  const [section, setSection] = useState(0)
  const { data, error, loading, refresh } = useExplain(scope === GLOBAL ? null : scope, provider === ANY ? null : provider)

  const scopeOptions = [
    { value: GLOBAL, displayValue: 'Global (no workspace)' },
    ...workspaces.map((item) => ({ value: item.id, displayValue: item.name })),
  ]
  const providerOptions = [
    { value: ANY, displayValue: section === PROMPTS_TAB ? 'Shared defaults' : 'Any provider' },
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
        <nav className="registry__subnav">
          <TabsDisplay index={section} select={setSection}>
            <TabList>
              {SECTIONS.map((name) => <Tab key={name}>{name}</Tab>)}
            </TabList>
          </TabsDisplay>
        </nav>

        <main className="registry__body">
          {section === PROMPTS_TAB && <PromptsView key={provider} provider={provider === ANY ? null : provider} />}
          {section !== PROMPTS_TAB && error && <p className="registry__error">{error}</p>}
          {section !== PROMPTS_TAB && !data && !error && <p className="hint">Loading registry…</p>}
          {data && section === FLAGS_TAB && <FlagsView flags={data.flags || []} modes={data.modes} />}
          {data && section !== FLAGS_TAB && section !== PROMPTS_TAB && (
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
              <ModesCard modes={data.modes} flags={data.flags || []} onFlags={() => setSection(FLAGS_TAB)} />
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
