---
name: Harness tool-call analytics
overview: Add a `harness tool-stats` CLI command that grep-scans harness session `events.jsonl` files for tool calls and reports totals, per-tool frequency, frequency over time, per-run distribution, and subagent/step splits, all filterable by time range.
todos:
  - id: module
    content: Create services/harness/src/analytics/toolCalls.js (scan + dedupe + summarize + parseTime + formatText)
    status: completed
  - id: cli
    content: Wire tool-stats command and USAGE into services/harness/src/cli/index.js
    status: completed
  - id: make
    content: Add tool-stats target to services/harness/Makefile and services.harness.tool-stats to root Makefile
    status: completed
isProject: false
---

# Harness tool-call analytics

## Data source
Use each session's `events.jsonl` (`~/.harness/workspaces/<wid>/sessions/<sid>/events.jsonl`, plus legacy `writeDir/sessions`). It is provider-agnostic (cursor, codex, grok, claude), unlike `runs/*.cursor.jsonl`, and every tool record already carries `ts`, `runId`, `itemId`, `name`, `input`, and for decompose runs `phase`/`step`:

```json
{"ts":1790309400529,"type":"tool_call","itemId":"call-...","name":"glob","input":{...},"status":"running","runId":"r_mugfzmhc097daa"}
```

- Grep-style prefilter: stream lines and skip any without `"type":"tool_call"` before `JSON.parse`.
- Dedupe by `runId + itemId`, because each call emits running and completed records. Keep the first non-empty `name`, since grok's later updates replace `name` with a display title such as ``List `/path` ``.
- Join `session.json` (provider, model, workspaceId, cwd) and `workspace.json` (name) for grouping.
- Limitation: the parent transcript does not include tool calls made inside subagents. For subagents, the command reports `task` spawns grouped by `input.subagentType`, plus decompose step runs versus top-level runs.

## New module: `services/harness/src/analytics/toolCalls.js`
Use factory arrow functions with no semicolons, and reuse `store/paths.js` (`workspacesDir`, `sessionsDir`, `legacySessionsDir`).
- `scanToolCalls({ writeDir, since, until, workspace, session, provider, tool })` returns deduped call records `{ ts, runId, sessionId, workspaceId, workspaceName, provider, model, phase, step, name, subagentType }`. It skips a session when `session.updatedAt < since`.
- `summarize(calls, { bucket, by, top })` returns:
  - totals: calls, runs, sessions, first and last timestamp
  - by tool: count, percentage, runs using the tool, average per run
  - over time: counts per `hour|day|week` bucket in local time, as a matrix of the top N tools by bucket plus a total column
  - per run: mean, median, p90, max, and the top runs by call count
  - subagents: `task` counts by `subagentType`; decompose calls split by `step` (plan/execute) versus top-level
  - optional `--by workspace|provider|model|session` breakdown of tool counts
- `parseTime(value)` accepts ISO dates (`2026-09-01`) or relative values (`30m`, `24h`, `7d`, `4w`).
- `formatText(summary)` builds aligned plain-text tables. `--json` prints the raw summary.

## CLI: `services/harness/src/cli/index.js`
- Add a `tool-stats` case and a `USAGE` line:
  `tool-stats [--since t] [--until t] [--bucket hour|day|week] [--by workspace|provider|model|session] [--workspace wid] [--session sid] [--provider p] [--tool name] [--top n] [--json]`
- Defaults: all time, `--bucket day`, `--top 10`.

## Makefiles
- `services/harness/Makefile`: add `tool-stats: ## Tool-call analytics (ARGS="...")` running `./scripts/run-with-env-dir ./env-dir node bin/harness tool-stats $(ARGS)`, and add it to `.PHONY`.
- Root [Makefile](Makefile): add an explicit `services.harness.tool-stats` forwarding target with `ARGS`, a `.PHONY` entry, and a help line.

## Example
`make services.harness.tool-stats ARGS="--since 7d --bucket day --by provider"`