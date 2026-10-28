import { useEffect, useMemo, useState } from 'react'
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
import {
  LENGTH_BUCKETS,
  byDirectory,
  byLanguage,
  inBucket,
  inScope,
  lengthDistribution,
  sortFiles,
  summarize,
} from './aggregate'
import FileAgentActions from './FileAgentActions'
import './CodeStats.css'

const ALL = 'all'
const COUNT_SERIES = [{ id: 'count', title: 'Files' }]
const EDITOR_ICON = 'M4 5.5 1.5 8 4 10.5M12 5.5 14.5 8 12 10.5M9.2 3.5 6.8 12.5'

const EditorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={EDITOR_ICON} />
  </svg>
)

const DEPTH_OPTIONS = [
  ...['1', '2', '3', '4'].map((value) => ({ value, displayValue: `Depth ${value}` })),
  { value: ALL, displayValue: 'All depths' },
]

const LIMIT_OPTIONS = [
  ...['100', '500'].map((value) => ({ value, displayValue: `Top ${value}` })),
  { value: ALL, displayValue: 'All files' },
]

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatMean = (value) => (Number.isInteger(value) ? formatNumber(value) : value.toFixed(1))

const useCodeStats = (workspaceId) => {
  const [refreshToken, setRefreshToken] = useState(0)
  const [state, setState] = useState({ stats: null, error: null, loading: true })

  useEffect(() => {
    if (!workspaceId) return undefined
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    api
      .getCodeStats(workspaceId, { signal: controller.signal })
      .then(({ stats }) => setState({ stats, error: null, loading: false }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setState((prev) => ({ ...prev, error: err.message, loading: false }))
      })
    return () => controller.abort()
  }, [workspaceId, refreshToken])

  return { ...state, refresh: () => setRefreshToken((n) => n + 1) }
}

const Stat = ({ label, value, sub }) => (
  <CardSection>
    <CardLabel>{label}</CardLabel>
    <div className="code-stats__stat-val">{value}</div>
    {sub && <div className="code-stats__stat-sub">{sub}</div>}
  </CardSection>
)

const FilterSelect = ({ label, selected, options, select }) => (
  <SelectDisplay className="code-stats__select" aria-label={label} selected={selected} options={options} select={select} />
)

const CodeStatsView = ({ devId, workspace, providers, onCreated, onClose, onOpenFile }) => {
  const { stats, error, loading, refresh } = useCodeStats(workspace?.id)
  const [language, setLanguage] = useState(ALL)
  const [scope, setScope] = useState('')
  const [depth, setDepth] = useState('2')
  const [bucket, setBucket] = useState(null)
  const [limit, setLimit] = useState('100')

  useEffect(() => {
    setLanguage(ALL)
    setScope('')
    setBucket(null)
  }, [workspace?.id])

  const names = stats?.languages || {}
  const allFiles = stats?.files || []

  const view = useMemo(() => {
    const scoped = allFiles.filter(inScope(scope))
    const files = language === ALL ? scoped : scoped.filter((file) => file.language === language)
    const scopeDepth = scope ? scope.split('/').length : 0
    return {
      scopedLanguages: byLanguage(scoped, names),
      files,
      summary: summarize(files),
      languages: byLanguage(files, names),
      directories: byDirectory(files).filter((row) =>
        row.depth > scopeDepth && (depth === ALL || row.depth - scopeDepth === Number(depth))),
      distribution: lengthDistribution(files),
      ranked: sortFiles(files.filter(inBucket(bucket))),
    }
  }, [allFiles, names, scope, language, depth, bucket])

  const { summary, languages, directories, distribution, ranked } = view
  const shownFiles = limit === ALL ? ranked : ranked.slice(0, Number(limit))
  const maxLanguageLines = languages[0]?.lines || 1
  const maxDirLines = directories[0]?.lines || 1
  const maxFileLines = ranked[0]?.lines || 1
  const bucketLabel = LENGTH_BUCKETS.find((item) => item.id === bucket)?.label

  const languageOptions = [
    { value: ALL, displayValue: 'All languages' },
    ...view.scopedLanguages.map((row) => ({ value: row.id, displayValue: `${row.name} (${row.files})` })),
  ]

  const chartBars = distribution.map((row) => ({ id: row.id, label: row.label, values: { count: row.count } }))

  return (
    <DevScope id={devId} state={{ workspace: workspace?.id, language, scope, depth, bucket, loading }}>
      <div className="code-stats">
        <DevScope id="b6r1t4m" state={{ loading }}>
          <header className="code-stats__topbar">
            <Button devId="q4h7c0e" variant="secondary" size="sm" onClick={onClose}>
              ← Sessions
            </Button>
            <strong className="code-stats__title">Code stats</strong>
            {workspace && <code className="code-stats__root" title={stats?.root || workspace.cwd}>{workspace.name}</code>}
            <div className="code-stats__filters">
              {scope && (
                <DevScope id="v5q0m8p" state={{ scope }}>
                  <Badge variant="info" size="small" title="Directory scope" remove={() => setScope('')}>dir: {scope}</Badge>
                </DevScope>
              )}
              <DevScope id="z8f3p2k" state={{ language }}>
                <FilterSelect label="Language" selected={language} options={languageOptions} select={setLanguage} />
              </DevScope>
              <Button devId="j5d9s1w" variant="secondary" size="sm" onClick={refresh} disabled={loading || !workspace}>
                {loading ? 'Scanning…' : 'Rescan'}
              </Button>
            </div>
          </header>
        </DevScope>

        <div className="code-stats__body">
          {!workspace && <p className="hint">Select a workspace to analyze its code.</p>}
          {workspace && error && <p className="code-stats__error">{error}</p>}
          {workspace && !stats && !error && <p className="hint">Scanning workspace files…</p>}
          {stats && summary.files === 0 && <p className="hint">No text files match the current filters.</p>}

          {stats && summary.files > 0 && (
            <>
              <DevScope id="m2v6y8r" state={{ files: summary.files }}>
                <Card>
                  <CardRow>
                    <Stat label="Files" value={formatNumber(summary.files)} sub={formatBytes(summary.bytes)} />
                    <Stat label="Lines" value={formatNumber(summary.lines)} />
                    <Stat label="Avg lines / file" value={formatMean(summary.mean)} />
                    <Stat label="Median" value={formatMean(summary.median)} />
                    <Stat label="p90" value={formatNumber(summary.p90)} />
                    <Stat label="Largest" value={formatNumber(summary.max)} sub={summary.largest} />
                  </CardRow>
                  {(stats.skipped.binary > 0 || stats.skipped.large > 0) && (
                    <CardSection>
                      <p className="hint">
                        Skipped {formatNumber(stats.skipped.binary)} binary and {formatNumber(stats.skipped.large)} oversized files.
                        node_modules, package.json, package-lock.json, hidden, and gitignored files are excluded.
                      </p>
                    </CardSection>
                  )}
                </Card>
              </DevScope>

              <div className="code-stats__grid">
                <DevScope id="x1n4g7u" state={{ bucket }}>
                  <Card>
                    <CardHeader>File length distribution (lines)</CardHeader>
                    <CardSection>
                      <BarChart
                        devId="e9k2b5t"
                        barDevId="u3p8a6l"
                        label="Files by line count"
                        bars={chartBars}
                        series={COUNT_SERIES}
                        height={200}
                        showLegend={false}
                        formatValue={formatNumber}
                        selectedId={bucket}
                        select={(bar) => setBucket((current) => (current === bar.id ? null : bar.id))}
                      />
                      <p className="hint">Click a bar to filter the file list by length.</p>
                    </CardSection>
                  </Card>
                </DevScope>

                <DevScope id="g7s0w3j" state={{ languages: languages.length }}>
                  <Card>
                    <CardHeader>By language</CardHeader>
                    <CardSection>
                      <Matrix
                        devId="o5c9f1i"
                        rowDevId="y2l6q4h"
                        className="code-stats__table"
                        label="Line counts by language"
                        rowLabel="Language"
                        rows={languages}
                        columns={[
                          { id: 'share', title: 'Lines' },
                          { id: 'files', title: 'Files' },
                          { id: 'mean', title: 'Avg' },
                          { id: 'median', title: 'Median' },
                          { id: 'max', title: 'Max' },
                        ]}
                        renderRowHeader={(row) => (
                          <button
                            type="button"
                            className={`code-stats__link${row.id === language ? ' code-stats__link--active' : ''}`}
                            title={row.id === language ? 'Show all languages' : 'Filter to this language'}
                            onClick={() => setLanguage((current) => (current === row.id ? ALL : row.id))}
                          >
                            {row.name}
                          </button>
                        )}
                        renderCell={(row, column) => {
                          if (column.id === 'share') {
                            return <ProgressBar label={formatNumber(row.lines)} value={row.lines} max={maxLanguageLines} addClassName="code-stats__share" />
                          }
                          if (column.id === 'mean' || column.id === 'median') return formatMean(row[column.id])
                          return formatNumber(row[column.id])
                        }}
                      />
                    </CardSection>
                  </Card>
                </DevScope>
              </div>

              <DevScope id="w8t1e7d" state={{ depth, dirs: directories.length }}>
                <Card>
                  <CardHeader>
                    <div className="code-stats__card-header">
                      <span>Directories{scope ? ` in ${scope}` : ''}</span>
                      <DevScope id="a4m9r2z" state={{ depth }}>
                        <FilterSelect label="Directory depth" selected={depth} options={DEPTH_OPTIONS} select={setDepth} />
                      </DevScope>
                    </div>
                  </CardHeader>
                  <CardSection>
                    {directories.length ? (
                      <Matrix
                        devId="h6j3u8b"
                        rowDevId="r0x5k9c"
                        className="code-stats__table"
                        label="Line totals by directory"
                        rowLabel="Directory"
                        rows={directories}
                        columns={[
                          { id: 'share', title: 'Lines' },
                          { id: 'files', title: 'Files' },
                          { id: 'mean', title: 'Avg' },
                          { id: 'max', title: 'Max' },
                          { id: 'largest', title: 'Largest file' },
                        ]}
                        renderRowHeader={(row) => (
                          <button type="button" className="code-stats__link" title="Scope to this directory" onClick={() => setScope(row.path)}>
                            {scope ? row.path.slice(scope.length + 1) : row.path}
                          </button>
                        )}
                        renderCell={(row, column) => {
                          if (column.id === 'share') {
                            return <ProgressBar label={formatNumber(row.lines)} value={row.lines} max={maxDirLines} addClassName="code-stats__share" />
                          }
                          if (column.id === 'mean') return formatMean(row.mean)
                          if (column.id === 'largest') return <code className="code-stats__path">{row.largest.slice(row.path.length + 1)}</code>
                          return formatNumber(row[column.id])
                        }}
                      />
                    ) : (
                      <p className="hint">No directories at this depth.</p>
                    )}
                  </CardSection>
                </Card>
              </DevScope>

              <DevScope id="n7b2i5f" state={{ limit, bucket, files: ranked.length }}>
                <Card>
                  <CardHeader>
                    <div className="code-stats__card-header">
                      <span>Files by length ({formatNumber(ranked.length)})</span>
                      {bucketLabel && (
                        <Badge variant="info" size="small" title="Length filter" remove={() => setBucket(null)}>{bucketLabel} lines</Badge>
                      )}
                      <DevScope id="f3y8o1q" state={{ limit }}>
                        <FilterSelect label="File limit" selected={limit} options={LIMIT_OPTIONS} select={setLimit} />
                      </DevScope>
                    </div>
                  </CardHeader>
                  <CardSection>
                    <Matrix
                      devId="l9e4d6s"
                      rowDevId="s1g7z3n"
                      className="code-stats__table code-stats__table--page"
                      label="Files ranked by line count"
                      rowLabel="File"
                      rows={shownFiles.map((file) => ({ id: file.path, ...file }))}
                      columns={[
                        { id: 'share', title: 'Lines' },
                        { id: 'language', title: 'Language' },
                        { id: 'bytes', title: 'Size' },
                        { id: 'open', title: 'Open' },
                        { id: 'agent', title: 'Agent' },
                      ]}
                      renderRowHeader={(row) => <code className="code-stats__path">{scope ? row.path.slice(scope.length + 1) : row.path}</code>}
                      renderCell={(row, column) => {
                        if (column.id === 'share') {
                          return <ProgressBar label={formatNumber(row.lines)} value={row.lines} max={maxFileLines} addClassName="code-stats__share" />
                        }
                        if (column.id === 'language') return names[row.language] || row.language
                        if (column.id === 'open') {
                          return (
                            <Button
                              devId="t6h1c9m"
                              variant="ghost"
                              size="sm"
                              title="Open in the text editor"
                              aria-label={`Open ${row.path} in the text editor`}
                              onClick={() => onOpenFile(row.path)}
                              disabled={!onOpenFile}
                            >
                              <EditorIcon />
                            </Button>
                          )
                        }
                        if (column.id === 'agent') {
                          return (
                            <FileAgentActions
                              path={stats.root ? `${stats.root}/${row.path}` : row.path}
                              workspace={workspace}
                              providers={providers}
                              onCreated={onCreated}
                            />
                          )
                        }
                        return formatBytes(row.bytes)
                      }}
                    />
                  </CardSection>
                </Card>
              </DevScope>
            </>
          )}
        </div>
      </div>
    </DevScope>
  )
}

export default CodeStatsView
