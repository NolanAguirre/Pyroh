import { Button, DevScope, Popup } from 'component-library'
import api from '../../api'
import NewSessionForm from '../NewSessionForm'

const FILE_AGENT_MODES = [
  {
    id: 'split-review',
    label: 'Review how to break up this file',
    submitLabel: 'Start review',
    icon: 'M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM10.3 10.3l3.2 3.2',
    devId: 'c5r8v2n',
    popupDevId: 'c9t3m6x',
    formDevId: 'c2w7k4j',
    prompt: (path) =>
      `${path}. Why is this file so long? Can it be broken up? Do not make any code changes, just explore the page and evaluate how it could be broken up. Do not search any other part of the code base, review only this file.`,
    start: (sessionId, prompt) => api.plan(sessionId, prompt),
  },
  {
    id: 'split-edit',
    label: 'Break up this file',
    submitLabel: 'Start refactor',
    icon: 'M4.5 3a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM4.5 10a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM5.8 5.2L13 12M5.8 10.8L13 4',
    devId: 'd8n1q5z',
    popupDevId: 'd3h6b9s',
    formDevId: 'd7p2y4g',
    prompt: (path) =>
      `${path}. Why is this file so long? Break it up into multiple files where it makes sense. Keep behavior identical and match the existing code style. Focus only on this file; do not search any other part of the code base beyond updating imports that reference the code you move.`,
    start: (sessionId, prompt) => api.run(sessionId, { prompt, mode: 'agent' }),
  },
]

const Icon = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const FileAgentActions = ({ path, workspace, providers = [], onCreated }) => (
  <DevScope id="x6a3f9e" state={{ path }}>
    <div className="code-stats__agent-actions">
      {FILE_AGENT_MODES.map((mode) => (
        <Popup key={mode.id} devId={mode.popupDevId} panelClassName="new-session-panel">
          <NewSessionForm
            devId={mode.formDevId}
            providers={providers}
            workspace={workspace}
            title={mode.label}
            submitLabel={mode.submitLabel}
            afterCreate={(session) => mode.start(session.id, mode.prompt(path))}
            onCreated={onCreated}
          />
          <Button devId={mode.devId} variant="ghost" size="sm" title={mode.label} aria-label={`${mode.label}: ${path}`}>
            <Icon d={mode.icon} />
          </Button>
        </Popup>
      ))}
    </div>
  </DevScope>
)

export default FileAgentActions
