import { useRef, useState } from 'react'
import api from '../../api'
import { isDirty } from './useOpenFiles'
import { absolutePath, isWithin, joinPath, parentOf } from './paths'

const cleanName = (value) => (value || '').trim().replace(/^\/+|\/+$/g, '')

const useExplorer = ({ workspaceId, tree, files }) => {
  const [owner, setOwner] = useState(workspaceId)
  const [selectedId, setSelectedId] = useState(null)
  const [editingPath, setEditingPath] = useState(null)
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const editingRef = useRef(null)
  const pendingRef = useRef(null)

  const setEditing = (value) => {
    editingRef.current = value
    setEditingPath(value)
  }

  const setPendingItem = (value) => {
    pendingRef.current = value
    setPending(value)
  }

  if (owner !== workspaceId) {
    setOwner(workspaceId)
    setSelectedId(null)
    setEditing(null)
    setPendingItem(null)
    setError(null)
  }

  const findEntry = (path) => (tree.childrenByPath[parentOf(path)] || []).find((entry) => entry.path === path) || null

  const targetDir = (item) => {
    const target = item || (selectedId && findEntry(selectedId))
    if (!target) return ''
    return target.type === 'dir' ? target.path : parentOf(target.path)
  }

  const startCreate = (type, item) => {
    const parent = targetDir(item)
    setError(null)
    setEditing(null)
    if (parent) tree.expand(parent)
    setPendingItem({ parent, type })
  }

  const startRename = (item) => {
    if (!item || item.pending) return
    setError(null)
    setPendingItem(null)
    setSelectedId(item.path)
    setEditing(item.path)
  }

  const cancel = () => {
    setPendingItem(null)
    setEditing(null)
  }

  const commitCreate = async (value) => {
    const current = pendingRef.current
    setPendingItem(null)
    const name = cleanName(value)
    if (!current || !name) return
    const path = joinPath(current.parent, name)
    try {
      if (current.type === 'dir') await api.fsCreateDir(workspaceId, path)
      else await api.fsCreateFile(workspaceId, path)
      await tree.refresh(current.parent)
      setSelectedId(path)
      if (current.type === 'file') files.open(path)
    } catch (err) {
      setError(`Could not create '${name}': ${err.message}`)
    }
  }

  const commitRename = async (item, value) => {
    const from = editingRef.current
    if (!from || from !== item.path) return
    setEditing(null)
    const name = cleanName(value)
    if (!name || name === item.name) return
    const to = joinPath(parentOf(from), name)
    try {
      await api.fsRename(workspaceId, from, to)
      tree.remap(from, to)
      files.rename(from, to)
      setSelectedId(to)
      await tree.refresh(parentOf(from))
      if (parentOf(to) !== parentOf(from)) await tree.refresh(parentOf(to))
    } catch (err) {
      setError(`Could not rename '${item.name}': ${err.message}`)
    }
  }

  const remove = async (item) => {
    if (!item || item.pending) return
    const isDir = item.type === 'dir'
    const unsaved = files.tabs.filter((tab) => isWithin(tab.path, item.path) && isDirty(tab)).length
    const message = [
      `Delete '${item.name}'${isDir ? ' and all of its contents' : ''}?`,
      unsaved ? `${unsaved} unsaved ${unsaved === 1 ? 'file' : 'files'} will be lost.` : '',
    ].filter(Boolean).join(' ')
    if (!window.confirm(message)) return
    setError(null)
    try {
      await api.fsDelete(workspaceId, item.path)
      files.removeUnder(item.path)
      if (selectedId && isWithin(selectedId, item.path)) setSelectedId(null)
      await tree.refresh(parentOf(item.path))
    } catch (err) {
      setError(`Could not delete '${item.name}': ${err.message}`)
    }
  }

  const refresh = (item) => {
    setError(null)
    return tree.refresh(item ? item.path : '')
  }

  const copyPath = (item, relative = false) => {
    const text = relative ? item.path : absolutePath(tree.root, item.path)
    if (!navigator.clipboard) {
      setError('Clipboard is unavailable in this context.')
      return
    }
    navigator.clipboard.writeText(text).catch((err) => setError(`Could not copy path: ${err.message}`))
  }

  return {
    selectedId,
    setSelectedId,
    editingPath,
    pending,
    error,
    clearError: () => setError(null),
    startCreate,
    startRename,
    cancel,
    commitCreate,
    commitRename,
    remove,
    refresh,
    copyPath,
  }
}

export default useExplorer
