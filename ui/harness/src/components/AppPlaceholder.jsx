import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardSection,
  CardRow,
  CardLabel,
  DevScope,
  FolderIcon,
  Popup,
} from 'component-library'
import NewSessionForm from './NewSessionForm'
import NewWorkspaceForm from './NewWorkspaceForm'

const MODE_ICONS = { agent: '▶', ask: '?', plan: '◇', decompose: '⑂', 'token-waste': '⚙', 'memory-extract': '✎', 'new-chat': '↪' }

const AppPlaceholder = ({ workspace, workspaces = [], sessions = [], providers = [], modes = [], onCreated, onWorkspaceCreated, onOpenEditor }) => (
  <DevScope id="hr3n8w4" state={{ workspace: workspace?.id, sessionCount: sessions.length }}>
    <div className="app__placeholder-hero">
      <div className="app__placeholder-content">
        <div className="app__hero-badge">
          <Badge variant="primary" size="small">Cursor SDK Harness</Badge>
        </div>
        <h1 className="app__hero-title">Multi-Agent Development Environment</h1>
        <p className="app__hero-desc">
          {modes.length ? `Run interactive turns with ${modes.map((mode) => mode.label).join(', ')} modes.` : 'Run interactive agent turns.'}
        </p>

        {workspace ? (
          <Card>
            <CardHeader>
              <div className="app__ws-card-header">
                <span className="app__ws-card-title">Active Workspace: {workspace.name}</span>
                <Badge variant="info" size="small">{sessions.length} sessions</Badge>
              </div>
            </CardHeader>
            <CardSection>
              <div className="app__ws-cwd">
                <FolderIcon size={14} className="app__ws-cwd-icon" />
                <code>{workspace.cwd}</code>
              </div>
            </CardSection>
            <CardRow>
              <CardSection>
                <CardLabel>Quick Actions</CardLabel>
                <div className="app__hero-actions">
                  <Popup devId="y3m7p9d" panelClassName="new-session-panel">
                    <NewSessionForm
                      devId="e2b8v4k"
                      providers={providers}
                      workspace={workspace}
                      onCreated={onCreated}
                    />
                    <Button variant="primary" size="sm" devId="d6t1j9x">
                      + Start Session
                    </Button>
                  </Popup>
                  {onOpenEditor && (
                    <Button variant="secondary" size="sm" onClick={onOpenEditor} devId="n8k3w7f">
                      Open File Editor
                    </Button>
                  )}
                </div>
              </CardSection>
            </CardRow>
          </Card>
        ) : (
          <Card>
            <CardHeader>Get Started</CardHeader>
            <CardSection>
              <p className="hint">No workspace selected. Create a workspace to point at your working directory.</p>
              <div className="app__hero-actions">
                <Popup devId="a4r9b2m" panelClassName="new-session-panel">
                  <NewWorkspaceForm devId="u7m1v5c" onCreated={onWorkspaceCreated} />
                  <Button variant="primary" size="sm">
                    + Create Workspace
                  </Button>
                </Popup>
              </div>
            </CardSection>
          </Card>
        )}

        <div className="app__capabilities-grid">
          {modes.map((mode) => (
            <div key={mode.id} className="app__cap-tile">
              <span className="app__cap-icon">{MODE_ICONS[mode.id] || '◇'}</span>
              <strong>{mode.label}</strong>
              <p className="hint">{mode.hint}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </DevScope>
)

export default AppPlaceholder
