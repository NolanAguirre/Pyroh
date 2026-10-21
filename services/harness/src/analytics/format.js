// Plain-text tables for `harness tool-stats`.

const pad2 = (n) => String(n).padStart(2, '0')

const localDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const formatTs = (ts) => {
  if (!ts) return '-'
  const date = new Date(ts)
  return `${localDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

const table = (headers, rows) => {
  const cells = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '-' : String(cell))))
  const numeric = headers.map((_, i) => cells.length > 0 && cells.every((row) => /^-?[\d.]+%?$|^-$/.test(row[i])))
  const widths = headers.map((header, i) => Math.max(header.length, ...cells.map((row) => row[i].length)))
  const line = (row) => row
    .map((cell, i) => (numeric[i] ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
    .join('  ')
    .trimEnd()
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n')
}

const section = (title, body) => `${title}\n${body}`

const vsText = (pair) => (pair && (pair.cache || pair.fresh) ? `${pair.cachePct}% vs ${pair.freshPct}%` : '-')

const ioText = (tokens) => (tokens && tokens.inputPerOutput != null ? `${tokens.inputPerOutput}:1` : '-')

const formatText = (summary) => {
  const { range, totals, byTool, byWorkspace, overTime, perRun, subagents, breakdown, targets } = summary
  if (!totals.calls) {
    return `No tool calls found (range: ${formatTs(range.since)} .. ${formatTs(range.until)})`
  }
  const out = []

  out.push(section('Totals', table(
    ['calls', 'runs', 'sessions', 'first', 'last'],
    [[totals.calls, totals.runs, totals.sessions, formatTs(totals.first), formatTs(totals.last)]],
  )))

  out.push(section('By tool', table(
    ['tool', 'calls', 'pct', 'runs', 'per run'],
    byTool.map((entry) => [entry.tool, entry.count, `${entry.pct}%`, entry.runs, entry.perRun]),
  )))

  out.push(section('By workspace', table(
    ['workspace', 'sessions', 'runs', 'calls', 'tokens', 'reads', 'writes'],
    byWorkspace.map((entry) => [
      entry.workspaceName || entry.workspaceId || '(none)',
      entry.sessions,
      entry.runs,
      entry.calls,
      entry.tokens.total,
      entry.tokens.reads.cache + entry.tokens.reads.fresh,
      entry.tokens.writes.cache + entry.tokens.writes.fresh,
    ]),
  )))

  const timeHeaders = [overTime.bucket, ...overTime.tools, ...(overTime.hasOther ? ['other'] : []), 'total']
  out.push(section(`Over time (by ${overTime.bucket})`, table(
    timeHeaders,
    overTime.rows.map((row) => [
      row.bucket,
      ...overTime.tools.map((tool) => row.counts[tool] || 0),
      ...(overTime.hasOther ? [row.other] : []),
      row.total,
    ]),
  )))

  out.push(section('Per run', [
    table(
      ['runs', 'mean', 'median', 'p90', 'max'],
      [[perRun.runs, perRun.mean, perRun.median, perRun.p90, perRun.max]],
    ),
    '',
    table(
      ['cache reads', 'new reads', 'cache writes', 'new writes', 'in:out'],
      [[
        perRun.tokens.reads.cache,
        perRun.tokens.reads.fresh,
        perRun.tokens.writes.cache,
        perRun.tokens.writes.fresh,
        ioText(perRun.tokens),
      ]],
    ),
    '',
    table(
      ['run', 'session', 'provider', 'step', 'started', 'calls', 'reads', 'in:out'],
      perRun.top.map((run) => [
        run.runId,
        run.sessionId,
        run.provider,
        run.step,
        formatTs(run.firstTs),
        run.count,
        vsText(run.tokens && run.tokens.reads),
        ioText(run.tokens),
      ]),
    ),
  ].join('\n')))

  const subagentLines = [
    subagents.tasks.total
      ? table(['subagent', 'spawns'], subagents.tasks.byType.map((entry) => [entry.type, entry.count]))
      : 'No task spawns',
    '',
    table(
      ['scope', 'calls', 'runs'],
      [
        ['top-level', subagents.decompose.topLevel.count, subagents.decompose.topLevel.runs],
        ...subagents.decompose.steps.map((entry) => [`step:${entry.step}`, entry.count, entry.runs]),
      ],
    ),
  ]
  out.push(section('Subagents (tool calls inside subagents are not recorded)', subagentLines.join('\n')))

  if (breakdown) {
    out.push(section(`By ${breakdown.by}`, table(
      [breakdown.by, 'calls', 'runs', 'top tools'],
      breakdown.groups.map((group) => [
        group.key,
        group.count,
        group.runs,
        group.tools.map((entry) => `${entry.tool}:${entry.count}`).join(' '),
      ]),
    )))
  }

  if (targets) {
    out.push(section(
      `By target (${targets.tool}): ${targets.distinct} distinct, ${targets.repeats} same-run repeats, ${targets.exactRepeats} identical`,
      table(
        ['target', 'calls', 'runs', 'sessions', 'repeats', 'identical', 'variants'],
        targets.rows.map((row) => [row.key, row.count, row.runs, row.sessions, row.repeats, row.exactRepeats, row.variants]),
      ),
    ))
  }

  return out.join('\n\n')
}

module.exports = { formatText, formatTs, table }
