import { Badge, Button, DevScope, SelectDisplay } from 'component-library'
import { ALL, BUCKET_OPTIONS, GROUP_OPTIONS, RANGE_OPTIONS } from './constants'

const FilterSelect = ({ label, selected, options, select }) => (
  <SelectDisplay
    className="analytics__select"
    aria-label={label}
    selected={selected}
    options={options}
    select={select}
  />
)

const AnalyticsTopbar = ({
  workspaces,
  providers,
  range,
  setRange,
  bucket,
  setBucket,
  workspace,
  setWorkspace,
  provider,
  setProvider,
  by,
  setBy,
  tool,
  setTool,
  loading,
  refresh,
  onBack,
}) => {
  const workspaceOptions = [
    { value: ALL, displayValue: 'All workspaces' },
    ...workspaces.map((item) => ({ value: item.id, displayValue: item.name })),
  ]
  const providerOptions = [
    { value: ALL, displayValue: 'All providers' },
    ...providers.map((item) => ({ value: item.id, displayValue: item.id })),
  ]

  return (
    <DevScope id="96o3xtd" state={{ loading }}>
      <header className="analytics__topbar">
        <Button devId="4jzgw3p" variant="secondary" size="sm" onClick={onBack}>
          ← Sessions
        </Button>
        <strong className="analytics__title">Tool-call analytics</strong>
        <div className="analytics__filters">
          <DevScope id="zi5v3he" state={{ range }}>
            <FilterSelect label="Time range" selected={range} options={RANGE_OPTIONS} select={setRange} />
          </DevScope>
          <DevScope id="065qgcq" state={{ bucket }}>
            <FilterSelect label="Bucket" selected={bucket} options={BUCKET_OPTIONS} select={setBucket} />
          </DevScope>
          <DevScope id="ctx47o7" state={{ workspace }}>
            <FilterSelect label="Workspace" selected={workspace} options={workspaceOptions} select={setWorkspace} />
          </DevScope>
          <DevScope id="4hmn2dq" state={{ provider }}>
            <FilterSelect label="Provider" selected={provider} options={providerOptions} select={setProvider} />
          </DevScope>
          <DevScope id="lkd4loi" state={{ by }}>
            <FilterSelect label="Breakdown" selected={by} options={GROUP_OPTIONS} select={setBy} />
          </DevScope>
          {tool && (
            <DevScope id="qg2bgdt" state={{ tool }}>
              <Badge variant="info" size="small" title="Tool filter" remove={() => setTool(null)}>tool: {tool}</Badge>
            </DevScope>
          )}
          <Button devId="d40ahlf" variant="secondary" size="sm" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </header>
    </DevScope>
  )
}

export default AnalyticsTopbar
