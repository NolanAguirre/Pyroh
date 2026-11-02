# Agent scratchpad MCP plan

## Goal

Give agents a durable place to record useful loose ends during a run. Notes from parents and subagents should reach the user without requiring them to search transcripts.

Agent access is append-only. The user gets an inbox where they can read, resolve, dismiss, and reopen notes.

## First version

- One agent tool: `add`, registered on an MCP server named `harness_scratchpad`.
- Notes belong to a workspace and retain their source session, run, and agent.
- Child notes appear in the parent task's inbox, with links back to their source.
- Notes persist after a run ends, fails, or is cancelled.
- The UI shows notes during the run and keeps open notes available afterward.
- No agent read, search, edit, delete, or resolve tools. No automatic reminders, task creation, or agent-to-agent messaging.

## Tool contract

Proposed input:

```json
{
  "kind": "unfinished",
  "note": "The import handles new records, but duplicate IDs still need a clear merge rule.",
  "references": [{ "path": "services/example/import.js", "line": 42 }],
  "retryKey": "duplicate-id-merge-rule"
}
```

- `kind`: `edge_case`, `unfinished`, `question`, or `risk`.
- `note`: required plain text, up to 4,000 characters; explain the issue and why it matters.
- `references`: optional, up to 10 file references; paths are workspace-relative and line numbers are optional positive integers.
- `retryKey`: required, up to 128 characters; reuse only to retry the same note.
- Reject empty notes, invalid kinds, unknown fields, and oversized inputs with clear errors.

Derive workspace, session, run, parent/root task, provider, and agent identity from trusted execution context. Do not accept these as agent-supplied attribution. Reject writes when that context is missing or invalid.

Return a small receipt containing `id`, `createdAt`, and `duplicate`. A receipt is confirmation of a write, not access to the inbox. Acknowledge success only after the database commit.

Enforce uniqueness on `(sourceRunId, retryKey)`. Identical retries during an authorized run return the original receipt; reuse with different content returns a conflict. Do not deduplicate different agents' notes by text. Run completion revokes write access, including retries; committed notes remain available to the user.

## Storage and ownership

Keep the original note and attribution immutable. Store user-managed status separately, initially `open`, with `resolved` and `dismissed` alternatives and a last-change timestamp.

Each note needs an ID, creation time, workspace ID, source session/run IDs, root session/run IDs, available parent/agent attribution, kind, text, references, and retry key. Use a database transaction and uniqueness constraint to handle concurrent writes and retries. Group the task inbox by root session, retaining the root run to distinguish separate turns in that session.

Add authoritative scratchpad tables to the existing harness SQLite database through a Sqitch migration under `db/harness`. Use a dedicated store with explicit write failures. Existing session tables are rebuildable indexes; scratchpad records must not inherit their best-effort write behavior or be erased by index repair. Keep scratchpad tables in database backups and out of cache/index reset paths. Avoid cascading deletion through mirrored session records.

Persist routing information when the note is written so a child result arriving later is not required to deliver it. Keep notes visible if the source transcript is no longer available; show unavailable source links clearly. Workspace deletion should remove its notes through the normal workspace cleanup path.

Keep user read/status endpoints separate from the agent MCP surface and follow existing workspace access rules. Render note content as text, never executable markup or instructions. File references are navigation hints, not permission to read arbitrary paths.

## User experience

Add a Scratchpad entry near the existing task/session navigation, with an open-note count. Inside a task, include notes from its child runs. Also provide a workspace view so unfinished notes remain discoverable across tasks.

Each entry shows kind, note, source agent, timestamp, file references, source link, and status controls. Default to open notes, newest first; allow viewing resolved and dismissed notes. Resolving or dismissing a note does not change its original text. Reopening returns it to the open list.

Use the existing UI update mechanism to refresh notes and counts after successful writes. Fetch persisted notes when opening or reconnecting the UI so missed live events do not lose entries. Distinguish an empty inbox from a failed load.

No modal or notification for every note. The inbox is the durable record; final responses may mention that notes were added without reproducing the whole list.

## Agent guidance

Include short guidance wherever this MCP is exposed to parents and children:

> Record a note when losing it would leave the user unaware of something important. Capture concrete edge cases, unfinished work, questions, or risks. Skip routine progress and speculative noise. Writing a note does not replace completing assigned work or reporting a blocker directly. Avoid secrets and unnecessary personal data.

If a write fails, the agent must not claim the note was saved. Retry transient failures with the same key. If it remains unsaved, surface the issue in the normal result or final response.

## Implementation sequence

1. Add persistence and the append operation, including validation, attribution, transaction boundaries, and idempotency. Check the existing database maintenance paths before placing authoritative data alongside session indexes.
2. Add a dedicated run-bound credential and MCP route inside the harness service, with an nginx location using the existing project ports.
3. Attach the server to ordinary tool-enabled parent and child runs, independently of permission to delegate. Update provider tool allow-lists, including Grok, and keep text-only turns tool-free.
4. Add user-facing list/count/status operations with workspace and root-task filters and bounded pagination.
5. Add the inbox, source links, status controls, live refresh, and reconnect recovery.
6. Add agent guidance and prepare the acceptance cases below for the user to run.

Use the existing harness service, SQLite database, and nginx ports; no new service or port allocation is planned. Use Sqitch under `db/harness`, leaving revert and verify scripts empty. Any new lower-level Makefile targets need explicit root forwarding and help entries. Keep backend watching opt-in.

## Acceptance cases for later verification

- A parent write persists and appears in its task and workspace inboxes.
- A child write appears under the correct root task with accurate source attribution. Preserve deeper ancestry where the harness supports it; this feature does not enable nested delegation.
- A committed note survives process restart, source-run failure, cancellation, and delayed child results.
- Concurrent identical retries create one note; conflicting retry content fails clearly.
- Different runs using the same retry key do not collide.
- Missing context and invalid input fail without inserting a note; tool input cannot spoof attribution or target another workspace.
- Credentials expire with their source run, are separate from delegation credentials, and never appear in note receipts or ordinary logs.
- Cursor, Claude, Codex, and Grok receive the tool in supported tool-enabled turns, including children that cannot delegate.
- Agent tool discovery exposes only the append capability for scratchpad data.
- User status changes preserve note content, update counts, and persist after reload.
- A dropped live event is recovered by fetching persisted data on reconnect.
- Workspace filtering, pagination, deleted source links, empty states, and load errors behave clearly.
- A failed write produces no success receipt; an uncertain response can be retried safely.
- Index reconciliation and repair preserve scratchpad records; normal workspace deletion removes them deliberately.

This is a planning-only change. Builds, services, migrations, tests, and other verification are left for the user unless explicitly requested.

## Repository integration map

| Area | Existing files | Planned change |
| --- | --- | --- |
| Run attachment | `services/harness/src/harness/runTurn.js` | Attach `harness_scratchpad` for each eligible run, including children. Do not tie it to `canDelegate` or the memory-extract mode. |
| MCP transport | `services/harness/src/server/delegationMcp.js`, `services/harness/src/server/index.js` | Follow the existing HTTP MCP pattern in a separate scratchpad route, proposed as `/mcp/scratchpad/:token`. |
| Credentials | `services/harness/src/harness/delegation.js` | Reuse the pattern of random tokens stored as hashes and bound to an active session/run. Issue distinct scratchpad credentials for each writing run; do not reuse a parent's delegation token. |
| Attribution | `services/harness/src/store/runStore.js`, child session ancestry | Derive source identity from the credential and stored records. Use `parentSessionId`, `parentRunId`, and `rootSessionId`; resolve and persist the originating root run while ancestry is available. |
| Provider registration | `services/harness/src/agents/driver.js`, `services/harness/src/agents/providers/grok.js` | Use the existing `{ name, url }` server configuration. Update Grok's tool allow-list explicitly; its current memory-specific behavior is insufficient. |
| Persistence | `db/harness`, `services/harness/src/store/sessionIndex.js` | Add scratchpad tables and a dedicated `scratchpadStore.js`. The existing database uses `node:sqlite` and WAL; index writes currently tolerate failure, while note writes must report it. |
| User API and updates | `services/harness/src/server/routes.js`, `services/harness/src/server/sse.js` | Add list/count/status routes and committed-note/status notifications. Cover both task and workspace views, with persisted fetches on reconnect. |
| Navigation and UI | `services/harness/src/registry/builtins.js`, `ui/harness/src/components/AppPanels.jsx` | Register a Scratchpad panel and add its inbox view. Use the existing Memories panel only as a navigation example. |
| Proxy | `services/nginx` | Add the scratchpad MCP route alongside the existing `/mcp/agents/` route. Use the nginx URL in provider configuration. |

The memory MCP is not a suitable identity or storage boundary: it accepts session IDs in its URL, has no run credential, and is currently attached only in memory-extract mode. Its user-facing API also permits editing and deleting content. Keep scratchpad notes separate.

Before editing each area, read its scoped repository instructions. During implementation, confirm the precise workspace cleanup/backup hooks and how workspace-wide UI notifications are delivered; the lookup established session SSE but no existing workspace scratchpad feed. These details do not require a new service or change the tool contract.
