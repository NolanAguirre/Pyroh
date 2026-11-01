export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

export const STATUS_LABEL = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Untracked',
  '!': 'Conflict',
}

export const letterFor = (file, staged) => {
  if (file.conflicted) return '!'
  if (staged) return file.index
  return file.untracked ? 'U' : file.worktree
}

export const sameSelection = (a, b) => Boolean(a) && Boolean(b) && a.path === b.path && a.staged === b.staged

export const formatAgo = (ms) => {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}
