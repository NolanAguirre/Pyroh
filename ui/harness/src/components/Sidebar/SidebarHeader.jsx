import { Popup, Button, DevScope } from 'component-library'
import NewSessionForm from '../NewSessionForm'
import NewWorkspaceForm from '../NewWorkspaceForm'
import UiSettingsForm from '../UiSettingsForm'
import { ICONS, Icon } from './icons'

// Header buttons come from registry panels; these are their DevScope ids.
const PANEL_DEV_IDS = {
  editor: 'f2a6rat',
  terminal: 'gh4tt4y',
  git: '7vr4nuz',
  'code-stats': 'c7q2x9a',
  analytics: 'vqx75km',
  registry: 'r3g8x2k',
  memories: 'm7e4q2z',
}

const SidebarHeader = ({
  workspace,
  providers,
  panels,
  view,
  onOpenPanel,
  onWorkspaceCreated,
  onCreated,
  transcriptFontSize,
  onTranscriptFontSize,
  maxSubagentDepth,
  onMaxSubagentDepth,
  settingsError,
  hotkeySettings,
}) => (
  <DevScope id="t8w3n6p">
    <div className="sidebar__header">
      <div className="sidebar__header-actions">
        <Popup devId="n7p3v6c" panelClassName="ui-settings-panel">
          <UiSettingsForm
            devId="b2x9t5h"
            transcriptFontSize={transcriptFontSize}
            onTranscriptFontSize={onTranscriptFontSize}
            maxSubagentDepth={maxSubagentDepth}
            onMaxSubagentDepth={onMaxSubagentDepth}
            error={settingsError}
            hotkeySettings={hotkeySettings}
          />
          <Button variant="secondary" size="sm" devId="k4m8q2w" title="Settings" aria-label="Settings">
            <Icon d={ICONS.settings} />
          </Button>
        </Popup>
        {panels.map((panel) => {
          // `main` panels toggle inside the layout; `page` panels replace it.
          const toggle = panel.placement === 'main'
          const open = view === panel.id
          return (
            <Button
              key={panel.id}
              variant={toggle && open ? 'primary' : 'secondary'}
              size="sm"
              devId={PANEL_DEV_IDS[panel.id]}
              title={panel.title || panel.label}
              aria-label={panel.label}
              aria-pressed={toggle ? open : undefined}
              onClick={() => onOpenPanel?.(panel.id)}
              disabled={panel.needsWorkspace && !workspace}
            >
              {ICONS[panel.icon] ? <Icon d={ICONS[panel.icon]} /> : panel.label.slice(0, 2)}
            </Button>
          )
        })}
        <Popup devId="hr8v4j2" panelClassName="new-session-panel new-workspace-panel">
          <NewWorkspaceForm devId="hr0k6t2" onCreated={onWorkspaceCreated} />
          <Button variant="secondary" size="sm" devId="hr2p9x5" title="Create a new workspace" aria-label="New workspace">
            <Icon d={ICONS.workspace} />
          </Button>
        </Popup>
        <Popup devId="hr6d3q8" panelClassName="new-session-panel">
          <NewSessionForm
            devId="hr4q8c0"
            providers={providers}
            workspace={workspace}
            onCreated={onCreated}
          />
          <Button variant="primary" size="sm" disabled={!workspace} devId="hr4b7s1" title="Start a new session" aria-label="New session">
            <Icon d={ICONS.session} />
          </Button>
        </Popup>
      </div>
    </div>
  </DevScope>
)

export default SidebarHeader
