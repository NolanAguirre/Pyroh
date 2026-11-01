import { StatusBar, StatusBarItem } from 'component-library'

const GitStatusBar = ({ status, ahead, behind, busy, conflicted, stagedFiles, changedFiles, root }) => (
  <StatusBar devId="e8wby19">
    <StatusBarItem align="left" title={status?.upstream ? `Tracking ${status.upstream}` : 'No upstream'}>
      ⑂ {status?.branch || (status?.detached ? 'detached' : '—')}
    </StatusBarItem>
    {status?.upstream && (
      <StatusBarItem align="left">↑{ahead} ↓{behind}</StatusBarItem>
    )}
    {busy && <StatusBarItem align="left">{busy}…</StatusBarItem>}
    {conflicted && (
      <StatusBarItem align="left">
        <span className="editor-status__error">Merge conflicts</span>
      </StatusBarItem>
    )}
    <StatusBarItem align="right">{stagedFiles.length} staged · {changedFiles.length} changed</StatusBarItem>
    <StatusBarItem align="right" title={root}>
      <span className="editor-status__root">{root}</span>
    </StatusBarItem>
  </StatusBar>
)

export default GitStatusBar
