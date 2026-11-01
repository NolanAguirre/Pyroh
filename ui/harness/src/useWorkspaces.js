import { useCallback, useEffect, useState } from 'react'
import api from './api'

const byName = (a, b) => a.name.localeCompare(b.name)

// Workspace list without deleted rows, kept sorted by name on local edits.
const useWorkspaces = () => {
  const [workspaces, setWorkspaces] = useState([])
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false)

  const loadWorkspaces = useCallback(() => {
    api
      .listWorkspaces()
      .then(({ workspaces: list }) => {
        setWorkspaces(list.filter((item) => !item.deleted))
        setWorkspacesLoaded(true)
      })
      .catch(() => {
        setWorkspaces([])
        setWorkspacesLoaded(true)
      })
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const putWorkspace = (workspace) => {
    setWorkspaces((prev) => [...prev.filter((item) => item.id !== workspace.id), workspace].sort(byName))
  }

  const deleteWorkspace = async (id) => {
    await api.setWorkspaceDeleted(id, true)
    setWorkspaces((prev) => prev.filter((item) => item.id !== id))
  }

  return { workspaces, workspacesLoaded, putWorkspace, deleteWorkspace }
}

export default useWorkspaces
