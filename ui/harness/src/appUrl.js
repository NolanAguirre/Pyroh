const WORKSPACE_KEY = 'harness.activeWorkspaceId'
const WORKSPACE_PARAM = 'workspace'
const SESSION_PARAM = 'session'
const VIEW_PARAM = 'view'
const FILE_PARAM = 'file'
const TERM_PARAM = 'term'

export const selectionFromUrl = (url) => ({
  workspaceId: url.searchParams.get(WORKSPACE_PARAM),
  sessionId: url.searchParams.get(SESSION_PARAM),
  view: url.searchParams.get(VIEW_PARAM),
  file: url.searchParams.get(FILE_PARAM),
  term: url.searchParams.get(TERM_PARAM),
})

export const urlWithSelection = (url, workspaceId, sessionId, view, file, term) => {
  const next = new URL(url.href)
  if (workspaceId) next.searchParams.set(WORKSPACE_PARAM, workspaceId)
  else next.searchParams.delete(WORKSPACE_PARAM)
  if (sessionId) next.searchParams.set(SESSION_PARAM, sessionId)
  else next.searchParams.delete(SESSION_PARAM)
  if (view) next.searchParams.set(VIEW_PARAM, view)
  else if (view === null) next.searchParams.delete(VIEW_PARAM)
  if (file) next.searchParams.set(FILE_PARAM, file)
  else if (file === null || file === '') next.searchParams.delete(FILE_PARAM)
  if (term) next.searchParams.set(TERM_PARAM, term)
  else if (term === null || term === '') next.searchParams.delete(TERM_PARAM)
  return next
}

const readStoredWorkspace = () => {
  try {
    return localStorage.getItem(WORKSPACE_KEY) || null
  } catch {
    return null
  }
}

export const storeWorkspace = (workspaceId) => {
  try {
    if (workspaceId) localStorage.setItem(WORKSPACE_KEY, workspaceId)
    else localStorage.removeItem(WORKSPACE_KEY)
  } catch {
    // ignore
  }
}

// Put the last used workspace in the URL when it has none.
export const restoreStoredWorkspace = () => {
  if (new URL(window.location.href).searchParams.get(WORKSPACE_PARAM)) return
  const stored = readStoredWorkspace()
  if (stored) {
    const next = urlWithSelection(new URL(window.location.href), stored, new URL(window.location.href).searchParams.get(SESSION_PARAM))
    window.history.replaceState(null, '', next.href)
  }
}
