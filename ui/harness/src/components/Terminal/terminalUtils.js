export const DEFAULT_SIZE = { cols: 80, rows: 24 }

export const errorText = (err) => (err && err.message ? err.message : String(err))

export const connectionLabel = (status) => {
  if (!status) return 'Connecting…'
  if (status.exited) return status.exitCode == null ? 'Exited' : `Exited (${status.exitCode})`
  return status.connected ? 'Connected' : 'Reconnecting…'
}
