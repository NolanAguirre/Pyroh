import { useState } from 'react'
import { DevScope } from 'component-library'
import { ALL, NONE } from './constants'
import { tokenUsage } from './tokenMetrics'
import useToolStats from './useToolStats'
import AnalyticsTopbar from './AnalyticsTopbar'
import SummaryCard from './cards/SummaryCard'
import WorkspaceCard from './cards/WorkspaceCard'
import TotalsCard from './cards/TotalsCard'
import ToolCard from './cards/ToolCard'
import TargetCard from './cards/TargetCard'
import PerRunCard from './cards/PerRunCard'
import SubagentsCard from './cards/SubagentsCard'
import BreakdownCard from './cards/BreakdownCard'
import './Analytics.css'

const AnalyticsView = ({ devId, workspaces = [], providers = [], onBack, onOpenSession }) => {
  const [range, setRange] = useState('7d')
  const [bucket, setBucket] = useState('day')
  const [workspace, setWorkspace] = useState(ALL)
  const [provider, setProvider] = useState(ALL)
  const [by, setBy] = useState(NONE)
  const [tool, setTool] = useState(null)
  const [openTargets, setOpenTargets] = useState({})

  const { stats, error, loading, refresh } = useToolStats({
    since: range === ALL ? undefined : range,
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
    <DevScope id={devId} state={{ range, bucket, workspace, provider, by, tool, loading }}>
      <div className="analytics">
        <AnalyticsTopbar
          workspaces={workspaces}
          providers={providers}
          range={range}
          setRange={setRange}
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
          refresh={refresh}
          onBack={onBack}
        />

        <main className="analytics__body">
          {error && <p className="analytics__error">{error}</p>}
          {!stats && !error && <p className="hint">Loading tool-call metrics…</p>}
          {stats && totals.calls === 0 && <p className="hint">No tool calls in this range.</p>}

          {stats && totals.calls > 0 && (
            <>
              <SummaryCard totals={totals} perRun={perRun} />
              <WorkspaceCard
                byWorkspace={stats.byWorkspace || []}
                totalTokens={tokenUsage(perRun?.tokens).total}
                workspaceName={workspaceName}
              />
              <TotalsCard overTime={stats.overTime} />
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
