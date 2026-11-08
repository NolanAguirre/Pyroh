import { useEffect, useState } from 'react'
import { DevScope } from 'component-library'
import api from '../../api'
import { ALL, CUSTOM, NONE } from './constants'
import { tokenUsage } from './tokenMetrics'
import useToolStats from './useToolStats'
import AnalyticsTopbar from './AnalyticsTopbar'
import SummaryCard from './cards/SummaryCard'
import WorkspaceCard from './cards/WorkspaceCard'
import ToolCard from './cards/ToolCard'
import TargetCard from './cards/TargetCard'
import PerRunCard from './cards/PerRunCard'
import SubagentsCard from './cards/SubagentsCard'
import BreakdownCard from './cards/BreakdownCard'
import './Analytics.css'

const toDateInput = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const defaultCustomRange = () => {
  const today = new Date()
  const weekAgo = new Date(today)
  weekAgo.setDate(today.getDate() - 6)
  return { from: toDateInput(weekAgo), to: toDateInput(today) }
}

const rangeParams = (range, { from, to }) => {
  if (range === ALL) return {}
  if (range !== CUSTOM) return { since: range }
  return {
    since: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    until: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }
}

const AnalyticsView = ({ devId, workspaces = [], providers = [], onBack, onOpenSession }) => {
  const [range, setRange] = useState('7d')
  const [customRange, setCustomRange] = useState(defaultCustomRange)
  const [bucket, setBucket] = useState('day')
  const [workspace, setWorkspace] = useState(ALL)
  const [provider, setProvider] = useState(ALL)
  const [by, setBy] = useState(NONE)
  const [tool, setTool] = useState(null)
  const [openTargets, setOpenTargets] = useState({})
  const [checkpoints, setCheckpoints] = useState([])
  const [checkpointError, setCheckpointError] = useState('')
  const [checkpointRefresh, setCheckpointRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCheckpointError('')
    api.listCheckpoints({ signal: controller.signal })
      .then(({ checkpoints: items }) => {
        if (!controller.signal.aborted) setCheckpoints(items)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setCheckpointError(`Could not load checkpoints: ${err.message}`)
      })
    return () => controller.abort()
  }, [checkpointRefresh])

  const { stats, error, loading, refresh } = useToolStats({
    ...rangeParams(range, customRange),
    bucket,
    workspace: workspace === ALL ? undefined : workspace,
    provider: provider === ALL ? undefined : provider,
    by: by === NONE ? undefined : by,
    tool: tool || undefined,
    top: 10,
  })

  const workspaceName = (id) => workspaces.find((item) => item.id === id)?.name || id
  const toggleTool = (name) => setTool((current) => (current === name ? null : name))
  const toggleTarget = (key) => setOpenTargets((current) => ({ ...current, [key]: !current[key] }))

  const totals = stats?.totals
  const perRun = stats?.perRun

  return (
    <DevScope id={devId} state={{ range, customRange, bucket, workspace, provider, by, tool, loading }}>
      <div className="analytics">
        <AnalyticsTopbar
          workspaces={workspaces}
          providers={providers}
          range={range}
          checkpoints={checkpoints}
          setRange={setRange}
          customRange={customRange}
          setCustomRange={setCustomRange}
          bucket={bucket}
          setBucket={setBucket}
          workspace={workspace}
          setWorkspace={setWorkspace}
          provider={provider}
          setProvider={setProvider}
          by={by}
          setBy={setBy}
          tool={tool}
          setTool={setTool}
          loading={loading}
          refresh={() => {
            refresh()
            setCheckpointRefresh((value) => value + 1)
          }}
          onBack={onBack}
        />

        <main className="analytics__body">
          {error && <p className="analytics__error">{error}</p>}
          {checkpointError && <p className="analytics__error" role="alert">{checkpointError}</p>}
          {!stats && !error && <p className="hint">Loading tool-call metrics…</p>}
          {stats && totals.calls === 0 && <p className="hint">No tool calls in this range.</p>}

          {stats && (totals.calls > 0 || stats.subagents?.harness?.count > 0) && (
            <>
              <SummaryCard totals={totals} perRun={perRun} />
              <WorkspaceCard
                byWorkspace={stats.byWorkspace || []}
                totalTokens={tokenUsage(perRun?.tokens).total}
                workspaceName={workspaceName}
              />
              <ToolCard byTool={stats.byTool} tool={tool} toggleTool={toggleTool} />
              {stats.targets && (
                <TargetCard
                  targets={stats.targets}
                  openTargets={openTargets}
                  toggleTarget={toggleTarget}
                  onOpenSession={onOpenSession}
                />
              )}
              <PerRunCard perRun={perRun} onOpenSession={onOpenSession} />

              <div className="analytics__grid">
                <SubagentsCard subagents={stats.subagents} />
                {stats.breakdown && <BreakdownCard breakdown={stats.breakdown} workspaceName={workspaceName} />}
              </div>
            </>
          )}
        </main>
      </div>
    </DevScope>
  )
}

export default AnalyticsView
