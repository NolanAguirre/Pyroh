import { useEffect, useState } from 'react'
import {
  Badge,
  BarChart,
  Button,
  Card,
  CardHeader,
  CardLabel,
  CardRow,
  CardSection,
  DevScope,
  Matrix,
  ProgressBar,
  SelectDisplay,
} from 'component-library'
import api from '../../api'
import { formatNumber } from '../../format'
import './Analytics.css'

const ALL = 'all'
const NONE = 'none'
const OTHER = '__other'

const RANGE_OPTIONS = [
  { value: '24h', displayValue: 'Last 24 hours' },
  { value: '7d', displayValue: 'Last 7 days' },
  { value: '30d', displayValue: 'Last 30 days' },
  { value: '12w', displayValue: 'Last 12 weeks' },
  { value: ALL, displayValue: 'All time' },
]

const BUCKET_OPTIONS = ['hour', 'day', 'week'].map((value) => ({ value, displayValue: `Per ${value}` }))

const GROUP_OPTIONS = [
  { value: NONE, displayValue: 'No breakdown' },
  ...['workspace', 'provider', 'model', 'session'].map((value) => ({ value, displayValue: `By ${value}` })),
]

const formatTs = (ts) => (ts ? new Date(ts).toLocaleString() : '—')

const bucketLabel = (key, bucket) => (bucket === 'week' ? `wk ${key.slice(5)}` : key.slice(5))

const vsText = (pair) => (pair && (pair.cache || pair.fresh) ? `${pair.cachePct}% vs ${pair.freshPct}%` : '—')

const vsDetail = (pair) => (pair && (pair.cache || pair.fresh)
  ? `${formatNumber(pair.cache)} cache · ${formatNumber(pair.fresh)} new`
  : null)

const ioText = (tokens) => (tokens && tokens.inputPerOutput != null ? `${tokens.inputPerOutput} : 1` : '—')

const ioDetail = (tokens) => (tokens && (tokens.input || tokens.output)
  ? `${formatNumber(tokens.input)} in · ${formatNumber(tokens.output)} out`
  : null)

const tokenUsage = (tokens) => {
  const reads = tokens?.reads
  const writes = tokens?.writes
  const readTotal = (reads?.cache || 0) + (reads?.fresh || 0)
  const writeTotal = (writes?.cache || 0) + (writes?.fresh || 0)
  return { total: readTotal + writeTotal, readTotal, writeTotal, reads, writes }
}

const perRunAverage = (value, runs) => (runs ? value / runs : null)

const formatAverage = (value) => (value == null ? '—' : formatNumber(value))

const targetTableRows = (rows, openTargets) => rows.flatMap((row) => {
  const target = { id: row.key, rowKind: 'target', ...row }
  if (!openTargets[row.key]) return [target]
  return [
    target,
    ...row.sessionCalls.map((session) => ({
      id: `${row.key}\0${session.sessionId}`,
      rowKind: 'session',
      ...session,
    })),
  ]
})

const renderTargetCell = (row, column) => {
  if (row.rowKind === 'session' && column.id === 'sessions') return '—'
  if (column.id === 'last') return formatTs(row.lastTs)
  return formatNumber(row[column.id])
}

const tokenMetrics = (tokens) => {
  const usage = tokenUsage(tokens)
  const runs = tokens?.runs || 0
  const metric = (id, label, total, note) => ({
    id,
    label,
    total,
    avg: perRunAverage(total, runs),
    note,
  })
  return {
    runs,
    usage,
    rows: [
      metric('total', 'Total', usage.total, null),
      metric('reads', 'Reads', usage.readTotal, vsDetail(usage.reads)),
      metric('writes', 'Writes', usage.writeTotal, vsDetail(usage.writes)),
      metric('cache-reads', 'Cache reads', usage.reads?.cache || 0, shareSub(usage.reads, 'cache', 'reads')),
      metric('new-reads', 'New reads', usage.reads?.fresh || 0, shareSub(usage.reads, 'fresh', 'reads')),
      metric('cache-writes', 'Cache writes', usage.writes?.cache || 0, shareSub(usage.writes, 'cache', 'writes')),
      metric('new-writes', 'New writes', usage.writes?.fresh || 0, shareSub(usage.writes, 'fresh', 'writes')),
    ],
  }
}

const shareSub = (pair, side, kind) => {
  if (!pair || !(pair.cache || pair.fresh)) return null
  const pct = side === 'cache' ? pair.cachePct : pair.freshPct
  return `${pct}% of ${kind}`
}

const useToolStats = (params) => {
  const key = JSON.stringify(params)
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ stats: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .getToolStats(JSON.parse(key), { signal: controller.signal })
      .then(({ stats }) => setState({ stats, error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [key, refreshToken])

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) }
}

const Stat = ({ label, value, sub }) => (
  <CardSection>
    <CardLabel>{label}</CardLabel>
    <div className="analytics__stat-val">{value}</div>
    {sub && <div className="analytics__stat-sub">{sub}</div>}
  </CardSection>
)

const FilterSelect = ({ label, selected, options, select }) => (
  <SelectDisplay
    className="analytics__select"
    aria-label={label}
    selected={selected}
    options={options}
    select={select}
  />
)

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

  const workspaceOptions = [
    { value: ALL, displayValue: 'All workspaces' },
    ...workspaces.map((item) => ({ value: item.id, displayValue: item.name })),
  ]
  const providerOptions = [
    { value: ALL, displayValue: 'All providers' },
    ...providers.map((item) => ({ value: item.id, displayValue: item.id })),
  ]
  const workspaceName = (id) => workspaces.find((item) => item.id === id)?.name || id
  const toggleTool = (name) => setTool((current) => (current === name ? null : name))
  const toggleTarget = (key) => setOpenTargets((current) => ({ ...current, [key]: !current[key] }))

  const totals = stats?.totals
  const overTime = stats?.overTime
  const perRun = stats?.perRun
  const metrics = tokenMetrics(perRun?.tokens)
  const usage = metrics.usage
  const subagents = stats?.subagents
  const breakdown = stats?.breakdown
  const targets = stats?.targets
  const maxToolCount = stats?.byTool?.[0]?.count || 1
  const byWorkspace = stats?.byWorkspace || []
  const maxWorkspaceTokens = byWorkspace[0]?.tokens.total || 1
  const workspaceRows = byWorkspace.map((entry) => ({
    id: entry.workspaceId || '(none)',
    ...entry,
    usage: tokenUsage(entry.tokens),
  }))

  const chartSeries = overTime
    ? [
      ...overTime.tools.map((id) => ({ id, title: id })),
      ...(overTime.hasOther ? [{ id: OTHER, title: 'other', color: '#6b7280' }] : []),
    ]
    : []
  const chartBars = overTime
    ? overTime.rows.map((row) => ({
      id: row.bucket,
      label: bucketLabel(row.bucket, overTime.bucket),
      values: { ...row.counts, [OTHER]: row.other },
    }))
    : []
  const totalBars = chartSeries.map((item) => ({
    id: item.id,
    label: item.title,
    values: {
      [item.id]: chartBars.reduce((sum, bar) => sum + (Number(bar.values?.[item.id]) || 0), 0),
    },
  })).filter((bar) => bar.values[bar.id] > 0)

  const scopeRows = subagents
    ? [
      { id: 'top-level', label: 'Top-level runs', ...subagents.decompose.topLevel },
      ...subagents.decompose.steps.map((entry) => ({ id: `step:${entry.step}`, label: `Decompose ${entry.step}`, ...entry })),
    ]
    : []

  return (
    <DevScope id={devId} state={{ range, bucket, workspace, provider, by, tool, loading }}>
      <div className="analytics">
        <DevScope id="96o3xtd" state={{ loading }}>
          <header className="analytics__topbar">
            <Button devId="4jzgw3p" variant="secondary" size="sm" onClick={onBack}>
              ← Sessions
            </Button>
            <strong className="analytics__title">Tool-call analytics</strong>
            <div className="analytics__filters">
              <DevScope id="zi5v3he" state={{ range }}>
                <FilterSelect label="Time range" selected={range} options={RANGE_OPTIONS} select={setRange} />
              </DevScope>
              <DevScope id="065qgcq" state={{ bucket }}>
                <FilterSelect label="Bucket" selected={bucket} options={BUCKET_OPTIONS} select={setBucket} />
              </DevScope>
              <DevScope id="ctx47o7" state={{ workspace }}>
                <FilterSelect label="Workspace" selected={workspace} options={workspaceOptions} select={setWorkspace} />
              </DevScope>
              <DevScope id="4hmn2dq" state={{ provider }}>
                <FilterSelect label="Provider" selected={provider} options={providerOptions} select={setProvider} />
              </DevScope>
              <DevScope id="lkd4loi" state={{ by }}>
                <FilterSelect label="Breakdown" selected={by} options={GROUP_OPTIONS} select={setBy} />
              </DevScope>
              {tool && (
                <DevScope id="qg2bgdt" state={{ tool }}>
                  <Badge variant="info" size="small" title="Tool filter" remove={() => setTool(null)}>tool: {tool}</Badge>
                </DevScope>
              )}
              <Button devId="d40ahlf" variant="secondary" size="sm" onClick={refresh} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </Button>
            </div>
          </header>
        </DevScope>

        <main className="analytics__body">
          {error && <p className="analytics__error">{error}</p>}
          {!stats && !error && <p className="hint">Loading tool-call metrics…</p>}
          {stats && totals.calls === 0 && <p className="hint">No tool calls in this range.</p>}

          {stats && totals.calls > 0 && (
            <>
              <DevScope id="cwow06k" state={{ calls: totals.calls }}>
                <div className="analytics__summary">
                  <Card>
                    <CardRow>
                      <Stat label="Tool calls" value={formatNumber(totals.calls)} />
                      <Stat label="Runs" value={formatNumber(totals.runs)} sub={`${perRun.mean} calls / run`} />
                      <Stat label="Sessions" value={formatNumber(totals.sessions)} />
                    </CardRow>
                    <CardRow>
                      <Stat label="First call" value={formatTs(totals.first)} />
                      <Stat label="Last call" value={formatTs(totals.last)} />
                    </CardRow>
                  </Card>
                  <DevScope id="w7tq2na" state={{ runs: metrics.runs, total: usage.total, avg: metrics.rows[0].avg, reads: usage.readTotal, writes: usage.writeTotal }}>
                    <div className="analytics__usage">
                      <Card>
                        <CardHeader>
                          Token usage
                          <span className="analytics__usage-runs">{formatNumber(metrics.runs)} runs</span>
                        </CardHeader>
                        <div className="analytics__tokens">
                          <div className="analytics__token-row">
                            {metrics.rows.map((row) => (
                              <div key={row.id} className="analytics__token" title={row.note || undefined}>
                                <span className="analytics__token-label">{row.label}</span>
                                <span className="analytics__token-value">{formatNumber(row.total)}</span>
                                {row.note && <span className="analytics__token-note">{row.note}</span>}
                              </div>
                            ))}
                          </div>
                          <div className="analytics__token-row">
                            {metrics.rows.map((row) => (
                              <div key={`${row.id}-avg`} className="analytics__token">
                                <span className="analytics__token-label">Avg {row.label.toLowerCase()}</span>
                                <span className="analytics__token-value">{formatAverage(row.avg)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </Card>
                    </div>
                  </DevScope>
                </div>
              </DevScope>

              <DevScope id="p4w9z2e" state={{ workspaces: workspaceRows.length }}>
                <Card>
                  <CardHeader>By workspace</CardHeader>
                  <CardSection>
                    <Matrix
                      devId="g8j2r5t"
                      rowDevId="c3n7q1w"
                      className="analytics__table analytics__table--page"
                      label="Token usage and sessions by workspace"
                      rowLabel="Workspace"
                      rows={workspaceRows}
                      columns={[
                        { id: 'share', title: 'Token share' },
                        { id: 'total', title: 'Tokens' },
                        { id: 'reads', title: 'Reads' },
                        { id: 'writes', title: 'Writes' },
                        { id: 'sessions', title: 'Sessions' },
                        { id: 'runs', title: 'Runs' },
                        { id: 'avg', title: 'Avg tokens / run' },
                      ]}
                      renderRowHeader={(row) => (
                        row.workspaceId
                          ? workspaceName(row.workspaceId)
                          : <span className="hint">(no workspace)</span>
                      )}
                      renderCell={(row, column) => {
                        if (column.id === 'share') {
                          return (
                            <ProgressBar
                              label={`${usage.total ? Math.round((row.usage.total / usage.total) * 1000) / 10 : 0}%`}
                              value={row.usage.total}
                              max={maxWorkspaceTokens}
                              addClassName="analytics__share"
                            />
                          )
                        }
                        if (column.id === 'total') return formatNumber(row.usage.total)
                        if (column.id === 'reads') return <span title={vsDetail(row.usage.reads) || undefined}>{formatNumber(row.usage.readTotal)}</span>
                        if (column.id === 'writes') return <span title={vsDetail(row.usage.writes) || undefined}>{formatNumber(row.usage.writeTotal)}</span>
                        if (column.id === 'avg') return formatAverage(perRunAverage(row.usage.total, row.tokens.runs))
                        return formatNumber(row[column.id])
                      }}
                    />
                  </CardSection>
                </Card>
              </DevScope>

              <DevScope id="h3p7c1m" state={{ bars: totalBars.length }}>
                <Card>
                  <CardHeader>Totals</CardHeader>
                  <CardSection>
                    <BarChart
                      devId="r6v9d2x"
                      barDevId="t4b8s0j"
                      label="Total tool calls"
                      bars={totalBars}
                      series={chartSeries}
                      height={200}
                      showLegend={false}
                      formatValue={formatNumber}
                    />
                  </CardSection>
                </Card>
              </DevScope>

              <DevScope id="k27g7v7" state={{ tools: stats.byTool.length, tool }}>
                <Card>
                  <CardHeader>By tool</CardHeader>
                  <CardSection>
                    <Matrix
                      devId="xcx97r7"
                      rowDevId="dye0g66"
                      className="analytics__table analytics__table--page"
                        label="Tool call counts"
                        rowLabel="Tool"
                        rows={stats.byTool.map((entry) => ({ id: entry.tool, ...entry }))}
                        columns={[
                          { id: 'share', title: 'Share' },
                          { id: 'count', title: 'Calls' },
                          { id: 'runs', title: 'Runs' },
                          { id: 'perRun', title: 'Per run' },
                        ]}
                        renderRowHeader={(row) => (
                          <button
                            type="button"
                            className={`analytics__link${row.tool === tool ? ' analytics__link--active' : ''}`}
                            title={row.tool === tool ? 'Clear tool filter' : 'Filter to this tool'}
                            onClick={() => toggleTool(row.tool)}
                          >
                            {row.tool}
                          </button>
                        )}
                        renderCell={(row, column) => {
                          if (column.id === 'share') {
                            return (
                              <ProgressBar
                                label={`${row.pct}%`}
                                value={row.count}
                                max={maxToolCount}
                                addClassName="analytics__share"
                              />
                            )
                          }
                          if (column.id === 'perRun') return row.perRun
                          return formatNumber(row[column.id])
                        }}
                      />
                      {!tool && <p className="hint">Click a tool to break its calls down by file, pattern, or command.</p>}
                    </CardSection>
                  </Card>
                </DevScope>

                {targets && (
                  <DevScope id="fowik4x" state={{ tool: targets.tool, distinct: targets.distinct }}>
                    <Card>
                      <CardHeader>
                        By target — {targets.tool}
                        <span className="analytics__usage-runs">
                          {`${formatNumber(targets.distinct)} distinct · ${formatNumber(targets.repeats)} same-run repeats · ${formatNumber(targets.exactRepeats)} identical`}
                        </span>
                      </CardHeader>
                      <CardSection>
                        <Matrix
                          devId="g792lxx"
                          rowDevId="9ymrir5"
                          className="analytics__table"
                          label={`${targets.tool} calls by target`}
                          rowLabel="Target"
                          rows={targetTableRows(targets.rows, openTargets)}
                          columns={[
                            { id: 'count', title: 'Calls' },
                            { id: 'repeats', title: 'Same-run repeats' },
                            { id: 'exactRepeats', title: 'Identical repeats' },
                            { id: 'variants', title: 'Variants' },
                            { id: 'runs', title: 'Runs' },
                            { id: 'sessions', title: 'Sessions' },
                            { id: 'last', title: 'Last call' },
                          ]}
                          renderRowHeader={(row) => (
                            row.rowKind === 'session' ? (
                              <DevScope id="0zglbv6" state={{ session: row.sessionId, count: row.count, repeats: row.repeats, exactRepeats: row.exactRepeats, variants: row.variants, runs: row.runs }}>
                                <button
                                  type="button"
                                  className="analytics__link analytics__session-link"
                                  title={`Open session ${row.sessionId}`}
                                  onClick={() => onOpenSession(row)}
                                >
                                  {row.sessionName || row.sessionId}
                                </button>
                              </DevScope>
                            ) : (
                              <DevScope id="ovft33e" state={{ sessions: row.sessionCalls.length, open: !!openTargets[row.key] }}>
                                <button
                                  type="button"
                                  className={`analytics__target-toggle${openTargets[row.key] ? ' analytics__target-toggle--open' : ''}`}
                                  aria-expanded={!!openTargets[row.key]}
                                  onClick={() => toggleTarget(row.key)}
                                >
                                  <code className="analytics__target" title={`${row.kind}: ${row.key}`}>{row.key}</code>
                                  <span className="analytics__target-meta">
                                    <span aria-hidden="true">{openTargets[row.key] ? '▲' : '▼'} </span>
                                    {`${formatNumber(row.sessionCalls.length)} session${row.sessionCalls.length === 1 ? '' : 's'}`}
                                  </span>
                                </button>
                              </DevScope>
                            )
                          )}
                          renderCell={renderTargetCell}
                        />
                        {targets.truncated && <p className="hint">Showing top {formatNumber(targets.rows.length)} targets.</p>}
                      </CardSection>
                    </Card>
                  </DevScope>
                )}

                <DevScope id="xvkcchh" state={{ runs: perRun.runs, inOut: perRun.tokens.inputPerOutput }}>
                  <Card>
                    <CardHeader>Per run</CardHeader>
                    <CardRow>
                      <Stat label="Mean" value={perRun.mean} />
                      <Stat label="Median" value={perRun.median} />
                      <Stat label="p90" value={perRun.p90} />
                      <Stat label="Max" value={perRun.max} />
                    </CardRow>
                    <CardRow>
                      <Stat label="Cache vs new reads" value={vsText(perRun.tokens.reads)} sub={vsDetail(perRun.tokens.reads)} />
                      <Stat label="Input : output" value={ioText(perRun.tokens)} sub={ioDetail(perRun.tokens)} />
                    </CardRow>
                    <CardSection>
                      <CardLabel>Busiest runs</CardLabel>
                      <Matrix
                        devId="bv8stfy"
                        rowDevId="emsmoja"
                        className="analytics__table"
                        label="Busiest runs"
                        rowLabel="Run"
                        rows={perRun.top.map((run) => ({ id: `${run.sessionId}:${run.runId}`, ...run }))}
                        columns={[
                          { id: 'session', title: 'Session' },
                          { id: 'provider', title: 'Provider' },
                          { id: 'started', title: 'Started' },
                          { id: 'count', title: 'Calls' },
                          { id: 'reads', title: 'Cache vs new reads' },
                          { id: 'io', title: 'In : out' },
                        ]}
                        renderRowHeader={(row) => (
                          <button
                            type="button"
                            className="analytics__link"
                            title="Open session"
                            onClick={() => onOpenSession(row)}
                          >
                            {row.runId || '—'}
                          </button>
                        )}
                        renderCell={(row, column) => {
                          if (column.id === 'session') return <code>{row.sessionId}</code>
                          if (column.id === 'provider') return row.step ? `${row.provider} · ${row.step}` : row.provider
                          if (column.id === 'started') return formatTs(row.firstTs)
                          if (column.id === 'reads') return <span title={vsDetail(row.tokens?.reads) || undefined}>{vsText(row.tokens?.reads)}</span>
                          if (column.id === 'io') return <span title={ioDetail(row.tokens) || undefined}>{ioText(row.tokens)}</span>
                          return formatNumber(row.count)
                        }}
                      />
                    </CardSection>
                  </Card>
                </DevScope>

              <div className="analytics__grid">
                <DevScope id="xftf0jj" state={{ spawns: subagents.tasks.total }}>
                  <Card>
                    <CardHeader>Subagents &amp; decompose</CardHeader>
                    <CardSection>
                      <CardLabel>Task spawns ({formatNumber(subagents.tasks.total)})</CardLabel>
                      {subagents.tasks.total ? (
                        <Matrix
                          devId="k99hltr"
                          rowDevId="kf44qza"
                          className="analytics__table"
                          label="Subagent spawns"
                          rowLabel="Subagent"
                          rows={subagents.tasks.byType.map((entry) => ({ id: entry.type, ...entry }))}
                          columns={[{ id: 'count', title: 'Spawns' }]}
                          renderRowHeader={(row) => row.type}
                          renderCell={(row) => formatNumber(row.count)}
                        />
                      ) : (
                        <p className="hint">No subagent spawns.</p>
                      )}
                    </CardSection>
                    <CardSection>
                      <CardLabel>Scope</CardLabel>
                      <Matrix
                        devId="vobasl9"
                        rowDevId="yf6ilqv"
                        className="analytics__table"
                        label="Calls by scope"
                        rowLabel="Scope"
                        rows={scopeRows}
                        columns={[{ id: 'count', title: 'Calls' }, { id: 'runs', title: 'Runs' }]}
                        renderRowHeader={(row) => row.label}
                        renderCell={(row, column) => formatNumber(row[column.id])}
                      />
                      <p className="hint">Tool calls made inside subagents are not recorded in the parent transcript.</p>
                    </CardSection>
                  </Card>
                </DevScope>

                {breakdown && (
                  <DevScope id="ezhdxb4" state={{ by: breakdown.by, groups: breakdown.groups.length }}>
                    <Card>
                      <CardHeader>By {breakdown.by}</CardHeader>
                      <CardSection>
                        <Matrix
                          devId="htjgn7h"
                          rowDevId="z9x5kpy"
                          className="analytics__table"
                          label={`Tool calls by ${breakdown.by}`}
                          rowLabel={breakdown.by}
                          rows={breakdown.groups.map((group) => ({ id: group.key, ...group }))}
                          columns={[
                            { id: 'count', title: 'Calls' },
                            { id: 'runs', title: 'Runs' },
                            { id: 'tools', title: 'Top tools' },
                          ]}
                          renderRowHeader={(row) => (breakdown.by === 'workspace' ? workspaceName(row.key) : row.key)}
                          renderCell={(row, column) => {
                            if (column.id !== 'tools') return formatNumber(row[column.id])
                            return (
                              <span className="analytics__chips">
                                {row.tools.map((entry) => (
                                  <Badge key={entry.tool} size="small">{`${entry.tool} ${entry.count}`}</Badge>
                                ))}
                              </span>
                            )
                          }}
                        />
                      </CardSection>
                    </Card>
                  </DevScope>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </DevScope>
  )
}

export default AnalyticsView
