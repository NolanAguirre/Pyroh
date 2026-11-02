# Agent scratchpad MCP plan

## Goal

Give agents a durable place to record useful loose ends during a run. Notes from parents and subagents should reach the user without requiring them to search transcripts.

Agent access is append-only. The user gets an inbox where they can read, resolve, dismiss, and reopen notes.

## First version

- One agent tool: `scratchpad.add` (final registered name should follow the existing MCP convention).
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

Enforce uniqueness on `(sourceRunId, retryKey)`. Identical retries return the original receipt; reuse with different content returns a conflict. Do not deduplicate different agents' notes by text.

## Storage and ownership

Keep the original note and attribution immutable. Store user-managed status separately, initially `open`, with `resolved` and `dismissed` alternatives and a last-change timestamp.

Each note needs an ID, creation time, workspace ID, source session/run IDs, root task identity, available parent/agent attribution, kind, text, references, and retry key. Use a database transaction and uniqueness constraint to handle concurrent writes and retries.

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

1. Map existing MCP registration, trusted execution context, persistence, child ancestry, and UI update paths. Confirm how every supported provider receives the tool.
2. Add persistence and the append operation, including validation, attribution, transaction boundaries, and idempotency.
3. Expose the single MCP tool to parent and child runs using the existing tool transport.
4. Add user-facing list/count/status operations with workspace and root-task filters and bounded pagination.
5. Add the inbox, source links, status controls, live refresh, and reconnect recovery.
6. Add agent guidance and prepare the acceptance cases below for the user to run.

Prefer existing service and database boundaries if they fit. If a new service is needed, scaffold it with `bootstrap service add` and the required support options; create its matching database first if needed. Use the assigned project port block, nginx for any local reverse proxy, explicit root Makefile forwarding, and no default watching. Ask for a port block only if none is assigned. Use Sqitch migrations under the relevant `db/<project>` and leave revert and verify scripts empty.

## Acceptance cases for later verification

- A parent write persists and appears in its task and workspace inboxes.
- A child or nested child write appears under the correct root task with accurate source attribution.
- A committed note survives process restart, source-run failure, cancellation, and delayed child results.
- Concurrent identical retries create one note; conflicting retry content fails clearly.
- Different runs using the same retry key do not collide.
- Missing context and invalid input fail without inserting a note; tool input cannot spoof attribution or target another workspace.
- Agent tool discovery exposes only the append capability for scratchpad data.
- User status changes preserve note content, update counts, and persist after reload.
- A dropped live event is recovered by fetching persisted data on reconnect.
- Workspace filtering, pagination, deleted source links, empty states, and load errors behave clearly.
- A failed write produces no success receipt; an uncertain response can be retried safely.

This is a planning-only change. Builds, services, migrations, tests, and other verification are left for the user unless explicitly requested.

## Repository integration map

Pending the read-only repository lookup. Exact files and any remaining integration decisions will be added when that result arrives.
