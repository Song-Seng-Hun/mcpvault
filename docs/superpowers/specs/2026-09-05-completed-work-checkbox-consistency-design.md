# Completed Work Checkbox Consistency Design

## Problem

MCPVault deliberately keeps execution state in ordinary Obsidian Markdown as
well as structured `task_status` Properties. Those two representations can
currently disagree: an actionable note may declare `task_status: completed`
while its body still contains open Markdown tasks. Search and `list_tasks`
then advertise work that Home, flow, and dependency projections consider
finished. Agents can repeatedly rediscover stale plan steps or skip genuinely
unfinished work.

The existing task parser already ignores YAML frontmatter and matching
backtick or tilde fences, but it is private to `filesystem.ts`. Reimplementing
checkbox parsing in organization lint would create another Markdown dialect.

## Decision

Extract the existing parser into a small shared `markdown-tasks.ts` module and
reuse it unchanged from both filesystem task operations and organization
lint. When an actionable knowledge note has `task_status: completed` and one
or more open body tasks, lint emits
`completed_work_with_open_checkboxes` with a bounded count and first line.

The signal is advisory rather than a write gate. Direct Obsidian editing,
generic note writes, and Git remain authoritative. The server never checks a
box, removes text, or reopens a note automatically.

The review packet promotes the signal to priority 2. Its bounded curation plan
first calls `mcp.list_tasks` for the exact note with an explicit character
budget and then proposes
`wiki.triage` at the current note revision. The instruction requires the agent
to choose explicitly among:

1. reopen the note when work is genuinely unfinished;
2. complete or remove an obsolete checkbox through the existing
   revision-safe task/edit workflow;
3. move a real follow-up into a linked actionable note or `review_open_items`.

This preserves one source of task syntax and one source of note state without
inventing a second task database.

## Boundaries

- Only `task_status: completed` is contradictory. Open, waiting, blocked,
  someday, cancelled, and notes without task state are unchanged.
- Only real Markdown task items outside frontmatter and matching fences count.
- Completed checkboxes do not create an issue.
- The check is advisory and visibility-scoped through the existing lint and
  review projections.
- Output contains a count and line locator, not unbounded task text.
- `list_tasks` accepts `maxChars`, clips each task preview, and shrinks the
  returned page as needed so one pathological checkbox cannot consume the
  caller's context budget. Stable task IDs and exact line locators remain.
- No new fixed MCP tool, dynamic endpoint, daemon, plugin, or client setup is
  introduced.

## Components and data flow

1. `markdown-tasks.ts` owns deterministic extraction and stable task IDs.
2. `FileSystemService.listTasks` and `updateTask` consume the shared parser, so
   existing task behavior and IDs do not change.
3. `organizationLintIssues` consumes the same parser for the completed-work
   invariant.
4. The MCP task-list adapter returns a bounded projection with explicit totals,
   returned count, and truncation while preserving stable task locators.
5. `LlmWikiService.reviewPacket` raises the dedicated lint code before generic
   lint debt and emits a revision-bound repair plan.
6. `wiki.policy(work)`, README, and schema explain that structured completion
   and body checkboxes should agree while Markdown remains authoritative.

## Error and concurrency behavior

No mutation is performed by detection. The repair plan carries the current
revision; a concurrent edit makes the proposed mutation fail normally. A
truncated review packet keeps the selected path, issue code, revision, inspect
action, and mutation action. Fenced examples cannot trigger the issue.

## Verification

- Characterize task extraction before moving it and prove stable IDs remain
  unchanged.
- Add lint tests for one real open checkbox, completed boxes, frontmatter, and
  both fence styles.
- Add an integration test proving priority-2 routing, bounded output, exact
  `mcp.list_tasks` inspection, and revision-safe `wiki.triage` guidance.
- Run filesystem, organization, Wiki integration, policy, instruction-budget,
  compiled-protocol, build, and full repository tests.
