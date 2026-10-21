import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import api from '../../api'
import { baseName, isWithin, replacePrefix } from './paths'

const storageKey = (workspaceId) => `harness.editor.${workspaceId || 'base'}.open`

const readSession = (workspaceId) => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(workspaceId)) || 'null')
    const paths = Array.isArray(value?.paths) ? value.paths.filter((path) => typeof path === 'string' && path) : []
    return { paths: [...new Set(paths)], active: typeof value?.active === 'string' ? value.active : null }
  } catch {
    return { paths: [], active: null }
  }
}

const writeSession = (workspaceId, session) => {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(session))
  } catch {
    // ignore
  }
}

const makeTab = (path, restored = false) => ({
  path,
  name: baseName(path),
  content: null,
  savedContent: null,
  mtime: null,
  size: 0,
  binary: false,
  loading: true,
  error: null,
  saving: false,
  saveError: null,
  restored,
})

const initialState = (workspaceId) => {
  const { paths, active } = readSession(workspaceId)
  return {
    tabs: paths.map((path) => makeTab(path, true)),
    activePath: paths.includes(active) ? active : paths[0] || null,
  }
}

const fileFields = (file) => {
  const binary = Boolean(file.binary)
  const content = binary ? null : file.content ?? ''
  return { content, savedContent: content, mtime: file.mtime ?? null, size: file.size ?? 0, binary }
}

export const isDirty = (tab) => !tab.loading && !tab.binary && !tab.error && tab.content !== tab.savedContent

const withoutTabs = (prev, remove) => {
  const tabs = prev.tabs.filter((tab) => !remove(tab.path))
  if (tabs.length === prev.tabs.length) return prev
  if (!prev.activePath || !remove(prev.activePath)) return { ...prev, tabs }
  const index = prev.tabs.findIndex((tab) => tab.path === prev.activePath)
  const after = prev.tabs.slice(index + 1).find((tab) => !remove(tab.path))
  const before = prev.tabs.slice(0, Math.max(index, 0)).reverse().find((tab) => !remove(tab.path))
  return { tabs, activePath: (after || before)?.path || null }
}

const useOpenFiles = (workspaceId) => {
  const [owner, setOwner] = useState(workspaceId)
  const [state, setState] = useState(() => initialState(workspaceId))

  if (owner !== workspaceId) {
    setOwner(workspaceId)
    setState(initialState(workspaceId))
  }

  const { tabs, activePath } = state
  const workspaceRef = useRef(workspaceId)
  const stateRef = useRef(state)
  const inflight = useRef(new Set())

  useLayoutEffect(() => {
    workspaceRef.current = workspaceId
    stateRef.current = state
  })

  const patchTab = useCallback((path, patch) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) => (tab.path === path ? { ...tab, ...patch } : tab)),
    }))
  }, [])

  const findTab = (path) => stateRef.current.tabs.find((tab) => tab.path === path) || null

  useEffect(() => {
    tabs.forEach((tab) => {
      const workspace = workspaceRef.current
      const key = `${workspace || ''}\u0000${tab.path}`
      if (!tab.loading || inflight.current.has(key)) return
      inflight.current.add(key)
      api
        .fsRead(workspace, tab.path)
        .then(
          (file) => {
            if (workspaceRef.current !== workspace) return
            patchTab(tab.path, { ...fileFields(file), loading: false, error: null, restored: false })
          },
          (error) => {
            if (workspaceRef.current !== workspace) return
            if (tab.restored && error.status === 404) {
              setState((prev) => withoutTabs(prev, (path) => path === tab.path))
              return
            }
            patchTab(tab.path, { loading: false, error: error.message, restored: false })
          },
        )
        .finally(() => inflight.current.delete(key))
    })
  }, [tabs, patchTab])

  const pathsKey = tabs.map((tab) => tab.path).join('\n')

  useEffect(() => {
    if (owner !== workspaceId) return
    writeSession(workspaceId, { paths: pathsKey ? pathsKey.split('\n') : [], active: activePath })
  }, [owner, workspaceId, pathsKey, activePath])

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!stateRef.current.tabs.some(isDirty)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const open = useCallback((path) => {
    setState((prev) => {
      const existing = prev.tabs.find((tab) => tab.path === path)
      if (existing) {
        const tabsNext = existing.error
          ? prev.tabs.map((tab) => (tab.path === path ? { ...tab, loading: true, error: null } : tab))
          : prev.tabs
        if (tabsNext === prev.tabs && prev.activePath === path) return prev
        return { tabs: tabsNext, activePath: path }
      }
      const index = prev.tabs.findIndex((tab) => tab.path === prev.activePath)
      const tabsNext = [...prev.tabs]
      tabsNext.splice(index === -1 ? tabsNext.length : index + 1, 0, makeTab(path))
      return { tabs: tabsNext, activePath: path }
    })
  }, [])

  const activate = useCallback((path) => {
    setState((prev) => (prev.activePath === path || !prev.tabs.some((tab) => tab.path === path)
      ? prev
      : { ...prev, activePath: path }))
  }, [])

  const cycle = useCallback((delta) => {
    setState((prev) => {
      if (prev.tabs.length < 2) return prev
      const index = prev.tabs.findIndex((tab) => tab.path === prev.activePath)
      const next = prev.tabs[(index + delta + prev.tabs.length) % prev.tabs.length]
      return { ...prev, activePath: next.path }
    })
  }, [])

  const close = useCallback((path) => {
    const tab = findTab(path)
    if (!tab) return false
    if (isDirty(tab) && !window.confirm(`'${tab.name}' has unsaved changes. Close without saving?`)) return false
    setState((prev) => withoutTabs(prev, (item) => item === path))
    return true
  }, [])

  const closeAll = useCallback(() => {
    const dirty = stateRef.current.tabs.filter(isDirty)
    if (dirty.length === 1 && !window.confirm(`'${dirty[0].name}' has unsaved changes. Close all tabs without saving?`)) return false
    if (dirty.length > 1 && !window.confirm(`${dirty.length} files have unsaved changes. Close all tabs without saving?`)) return false
    setState((prev) => (prev.tabs.length === 0 ? prev : { tabs: [], activePath: null }))
    return true
  }, [])

  const update = useCallback((path, content) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) => (
        tab.path === path && !tab.loading && !tab.binary && tab.content !== content
          ? { ...tab, content, saveError: null }
          : tab
      )),
    }))
  }, [])

  const reload = useCallback(async (path) => {
    const workspace = workspaceRef.current
    try {
      const file = await api.fsRead(workspace, path)
      if (workspaceRef.current !== workspace) return false
      patchTab(path, { ...fileFields(file), loading: false, error: null, saveError: null })
      return true
    } catch (error) {
      if (workspaceRef.current === workspace) patchTab(path, { saveError: `Reload failed: ${error.message}` })
      return false
    }
  }, [patchTab])

  const save = useCallback(async (path) => {
    const tab = findTab(path)
    if (!tab || tab.loading || tab.binary || tab.error || tab.saving) return false
    if (!isDirty(tab)) return true
    const workspace = workspaceRef.current
    const { content } = tab
    const write = (mtime) => api.fsWrite(workspace, path, content, mtime)
    patchTab(path, { saving: true, saveError: null })
    try {
      let result
      try {
        result = await write(tab.mtime)
      } catch (error) {
        if (error.status !== 409) throw error
        if (window.confirm('File changed on disk. Overwrite?')) {
          result = await write(null)
        } else {
          patchTab(path, { saving: false })
          if (window.confirm(`Reload '${tab.name}' from disk? Your unsaved changes will be lost.`)) await reload(path)
          return false
        }
      }
      if (workspaceRef.current !== workspace) return false
      patchTab(path, { saving: false, savedContent: content, mtime: result.mtime ?? null, size: result.size ?? 0 })
      return true
    } catch (error) {
      if (workspaceRef.current === workspace) patchTab(path, { saving: false, saveError: error.message })
      return false
    }
  }, [patchTab, reload])

  const saveAll = useCallback(async () => {
    const dirty = stateRef.current.tabs.filter(isDirty).map((tab) => tab.path)
    for (const path of dirty) await save(path)
  }, [save])

  const rename = useCallback((from, to) => {
    setState((prev) => ({
      tabs: prev.tabs.map((tab) => {
        const path = replacePrefix(tab.path, from, to)
        return path === tab.path ? tab : { ...tab, path, name: baseName(path) }
      }),
      activePath: prev.activePath && replacePrefix(prev.activePath, from, to),
    }))
  }, [])

  const removeUnder = useCallback((path) => {
    setState((prev) => withoutTabs(prev, (item) => isWithin(item, path)))
  }, [])

  const activeTab = tabs.find((tab) => tab.path === activePath) || null

  return {
    tabs,
    activePath,
    activeTab,
    anyDirty: tabs.some(isDirty),
    open,
    activate,
    cycle,
    close,
    closeAll,
    update,
    save,
    saveAll,
    reload,
    rename,
    removeUnder,
  }
}

export default useOpenFiles
