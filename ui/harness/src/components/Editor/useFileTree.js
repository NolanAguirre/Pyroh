import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import api from '../../api'
import { isBelow, isWithin, parentOf, replacePrefix } from './paths'

const storageKey = (workspaceId) => `harness.editor.${workspaceId || 'base'}.expanded`

const readExpanded = (workspaceId) => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(workspaceId)) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id))] : []
  } catch {
    return []
  }
}

const writeExpanded = (workspaceId, ids) => {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(ids))
  } catch {
    // ignore
  }
}

const withoutKey = (map, key) => {
  if (!(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

const filterKeys = (map, keep) => {
  const next = {}
  let changed = false
  Object.entries(map).forEach(([key, value]) => {
    if (keep(key)) next[key] = value
    else changed = true
  })
  return changed ? next : map
}

const useFileTree = (workspaceId) => {
  const [owner, setOwner] = useState(workspaceId)
  const [root, setRoot] = useState(null)
  const [childrenByPath, setChildrenByPath] = useState({})
  const [errors, setErrors] = useState({})
  const [expandedIds, setExpandedIds] = useState(() => readExpanded(workspaceId))

  if (owner !== workspaceId) {
    setOwner(workspaceId)
    setRoot(null)
    setChildrenByPath({})
    setErrors({})
    setExpandedIds(readExpanded(workspaceId))
  }

  const workspaceRef = useRef(workspaceId)
  const expandedRef = useRef(expandedIds)
  const inflight = useRef(new Map())

  useLayoutEffect(() => {
    workspaceRef.current = workspaceId
    expandedRef.current = expandedIds
  })

  const load = useCallback((path) => {
    const workspace = workspaceRef.current
    const key = `${workspace || ''}\u0000${path}`
    if (inflight.current.has(key)) return inflight.current.get(key)
    const promise = api
      .fsList(workspace, path)
      .then(
        (result) => {
          if (workspaceRef.current !== workspace) return null
          if (path === '') setRoot(result.root)
          setChildrenByPath((prev) => ({ ...prev, [path]: result.entries || [] }))
          setErrors((prev) => withoutKey(prev, path))
          return result.entries || []
        },
        (error) => {
          if (workspaceRef.current !== workspace) return null
          setChildrenByPath((prev) => (prev[path] ? prev : { ...prev, [path]: [] }))
          setErrors((prev) => ({ ...prev, [path]: error.message }))
          return null
        },
      )
      .finally(() => inflight.current.delete(key))
    inflight.current.set(key, promise)
    return promise
  }, [])

  const refresh = useCallback(async (path = '') => {
    const entries = await load(path)
    if (!entries) return
    const dirs = new Set(entries.filter((entry) => entry.type === 'dir').map((entry) => entry.path))
    const gone = expandedRef.current.filter((id) => parentOf(id) === path && !dirs.has(id))
    const keep = (id) => !gone.some((dir) => isWithin(id, dir))
    const expanded = expandedRef.current.filter(keep)
    if (gone.length) {
      expandedRef.current = expanded
      setExpandedIds((prev) => prev.filter(keep))
    }
    const expandedSet = new Set(expanded)
    const keepCached = (key) => !isBelow(key, path) || expandedSet.has(key)
    setChildrenByPath((prev) => filterKeys(prev, keepCached))
    setErrors((prev) => filterKeys(prev, keepCached))
    await Promise.all(
      expanded.filter((id) => parentOf(id) === path && dirs.has(id)).map((id) => refresh(id)),
    )
  }, [load])

  useEffect(() => {
    refresh('')
  }, [workspaceId, refresh])

  useEffect(() => {
    expandedIds.forEach((id) => {
      if (childrenByPath[id]) return
      const siblings = childrenByPath[parentOf(id)]
      if (siblings && siblings.some((entry) => entry.path === id && entry.type === 'dir')) load(id)
    })
  }, [expandedIds, childrenByPath, load])

  useEffect(() => {
    if (owner === workspaceId) writeExpanded(workspaceId, expandedIds)
  }, [owner, workspaceId, expandedIds])

  const onExpandedChange = useCallback((ids) => setExpandedIds(Array.from(ids)), [])

  const expand = useCallback((path) => {
    if (!path) return
    const chain = []
    for (let current = path; current; current = parentOf(current)) chain.push(current)
    setExpandedIds((prev) => {
      const missing = chain.filter((id) => !prev.includes(id))
      return missing.length ? [...prev, ...missing] : prev
    })
  }, [])

  const collapseAll = useCallback(() => setExpandedIds([]), [])

  const remap = useCallback((from, to) => {
    setExpandedIds((prev) => prev.map((id) => replacePrefix(id, from, to)))
    setChildrenByPath((prev) => filterKeys(prev, (key) => !isWithin(key, from)))
  }, [])

  return {
    root,
    childrenByPath,
    errors,
    expandedIds,
    setExpandedIds: onExpandedChange,
    load,
    refresh,
    expand,
    collapseAll,
    remap,
  }
}

export default useFileTree
