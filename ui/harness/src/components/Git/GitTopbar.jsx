import { Button, DevScope, Popup, SelectDisplay } from 'component-library'
import NewBranchForm from './NewBranchForm'

const GitTopbar = ({
  workspaceId,
  workspace,
  workspaces,
  status,
  branches,
  busy,
  root,
  hasRemote,
  ahead,
  behind,
  onBack,
  onSelectWorkspace,
  repo,
}) => {
  const localOptions = branches.local.map((branch, index) => ({ value: `l${index}`, displayValue: branch.name, branch }))
  const remoteOnly = branches.remote.filter((remote) => {
    const short = remote.name.slice(remote.name.indexOf('/') + 1)
    return !branches.local.some((local) => local.name === short)
  })
  const remoteOptions = remoteOnly.map((branch, index) => ({ value: `r${index}`, displayValue: `${branch.name} (remote)`, branch }))
  const detachedOption = status && status.detached ? [{ value: 'detached', displayValue: `(detached ${String(status.oid || '').slice(0, 7)})` }] : []
  const branchOptions = [...detachedOption, ...localOptions, ...remoteOptions]
  const currentOption = status?.detached ? 'detached' : (localOptions.find((option) => option.branch.name === status?.branch)?.value || '')

  const switchBranch = (value) => {
    const option = branchOptions.find((item) => item.value === value)
    if (!option || !option.branch || option.value === currentOption) return
    const target = option.branch.ref.startsWith('refs/remotes/')
      ? option.branch.name.slice(option.branch.name.indexOf('/') + 1)
      : option.branch.name
    repo.checkout(target)
  }

  const workspaceOptions = workspaces.length
    ? workspaces.map((item) => ({ value: item.id, displayValue: item.name }))
    : [{ value: '', displayValue: 'Base directory' }]

  const switchWorkspace = (value) => {
    const next = workspaces.find((item) => item.id.toLowerCase() === value)
    if (next && next.id !== workspaceId) onSelectWorkspace(next.id)
  }

  return (
    <DevScope id="9f1uqju" state={{ workspace: workspaceId, branch: status?.branch || null, busy: busy || null }}>
      <header className="editor-topbar git-topbar">
        <Button devId="g3xfcks" variant="secondary" size="sm" onClick={onBack}>
          ← Sessions
        </Button>
        <div className="editor-topbar__title">
          <strong>{workspace?.name || 'Base directory'}</strong>
          <span className="editor-topbar__root" title={root}>{root}</span>
        </div>
        {status && (
          <div className="git-topbar__branch">
            <DevScope id="8f1tz86" state={{ branch: status.branch || null, count: branchOptions.length }}>
              <SelectDisplay
                className="editor-topbar__workspace git-topbar__branch-select"
                aria-label="Branch"
                selected={currentOption}
                options={branchOptions}
                select={switchBranch}
                disabled={Boolean(busy)}
              />
            </DevScope>
            <Popup devId="4d3lhkv" panelClassName="new-session-panel">
              <NewBranchForm
                devId="ervsdf2"
                current={status.branch}
                busy={busy}
                onCreate={(name, startPoint) => repo.checkout(name, { create: true, startPoint: startPoint || undefined })}
              />
              <Button devId="kf57qnr" variant="secondary" size="sm" title="Create a new branch" disabled={Boolean(busy)}>
                + Branch
              </Button>
            </Popup>
          </div>
        )}
        {status && (
          <div className="git-topbar__sync">
            <Button devId="5t95o0v" variant="ghost" size="sm" title="Fetch from all remotes" loading={busy === 'fetch'} disabled={Boolean(busy) || !hasRemote} onClick={repo.fetchRemotes}>
              Fetch
            </Button>
            <Button devId="7di69ic" variant="secondary" size="sm" title="Pull (fast-forward only)" loading={busy === 'pull'} disabled={Boolean(busy) || !status.upstream} onClick={repo.pull}>
              Pull{behind ? ` ↓${behind}` : ''}
            </Button>
            <Button
              devId="bzzdqr8"
              variant={ahead || (!status.upstream && status.branch) ? 'primary' : 'secondary'}
              size="sm"
              title={status.upstream ? `Push to ${status.upstream}` : 'Publish branch to remote'}
              loading={busy === 'push'}
              disabled={Boolean(busy) || !hasRemote || !status.branch}
              onClick={repo.push}
            >
              {status.upstream ? `Push${ahead ? ` ↑${ahead}` : ''}` : 'Publish'}
            </Button>
          </div>
        )}
        <DevScope id="pbi9d8j" state={{ workspace: workspaceId, count: workspaces.length }}>
          <SelectDisplay
            className="editor-topbar__workspace"
            aria-label="Workspace"
            selected={(workspaceId || '').toLowerCase()}
            options={workspaceOptions}
            select={switchWorkspace}
            disabled={workspaces.length === 0}
          />
        </DevScope>
      </header>
    </DevScope>
  )
}

export default GitTopbar
