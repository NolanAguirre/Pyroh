import { useState } from 'react'
import {
  Popup,
  DevScope,
  DropdownTypeahead,
  DropdownTypeaheadTrigger,
  DropdownTypeaheadMenu,
  FolderIcon,
} from 'component-library'
import EditWorkspaceForm from '../EditWorkspaceForm'
import { PencilIcon, TrashIcon } from './icons'

const WorkspaceSection = ({ workspaces, workspace, onSelectWorkspace, onWorkspaceUpdated, onDeleteWorkspace }) => {
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const deleteWorkspace = async () => {
    if (!workspace || deleteBusy || !onDeleteWorkspace) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await onDeleteWorkspace(workspace.id)
    } catch (err) {
      setDeleteError(err && err.message ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  const workspaceOptions = workspaces.map((item) => ({
    value: item.id,
    displayValue: item.name,
  }))

  return (
    <div className="sidebar__workspace">
      {workspaces.length === 0 ? (
        <DevScope id="r5t1y9b">
          <p className="hint">Create a workspace to choose a working directory.</p>
        </DevScope>
      ) : (
        <>
          <DevScope id="hr9f0l3">
            <div className="sidebar__workspace-selector">
              <div className="sidebar__workspace-picker">
                <DropdownTypeahead
                  key={workspace?.id || 'none'}
                  defaultValue={workspace?.id || ''}
                  options={workspaceOptions}
                  change={onSelectWorkspace}
                  filter
                >
                  <DropdownTypeaheadTrigger placeholder="Select a workspace…" />
                  <DropdownTypeaheadMenu filterPlaceholder="Find a workspace…" />
                </DropdownTypeahead>
              </div>
              <Popup devId="w8f2l5q" triggerDevId="n1d7x4m" panelClassName="new-session-panel edit-workspace-panel">
                <EditWorkspaceForm
                  devId="m4q8w2n"
                  workspace={workspace}
                  onUpdated={onWorkspaceUpdated}
                />
                <button
                  type="button"
                  className="sidebar__workspace-edit"
                  title="Edit workspace"
                  aria-label="Edit workspace"
                  disabled={!workspace}
                >
                  <PencilIcon />
                </button>
              </Popup>
            </div>
          </DevScope>
          {workspace && (
            <DevScope id="j6v0e3d" state={{ workspace: workspace.id, deleteBusy }}>
              <div className="sidebar__cwd" title={workspace.cwd}>
                <FolderIcon size={12} className="sidebar__cwd-icon" />
                <span className="sidebar__cwd-text">{workspace.cwd}</span>
                <button
                  type="button"
                  className="sidebar__cwd-delete"
                  title="Remove workspace"
                  aria-label="Remove workspace"
                  disabled={deleteBusy}
                  onClick={deleteWorkspace}
                >
                  <TrashIcon />
                </button>
              </div>
              {deleteError && (
                <p className="hint hint--error" role="alert">{deleteError}</p>
              )}
            </DevScope>
          )}
        </>
      )}
    </div>
  )
}

export default WorkspaceSection
