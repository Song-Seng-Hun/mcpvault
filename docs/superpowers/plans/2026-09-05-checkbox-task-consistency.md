# Checkbox task consistency implementation plan

Inline execution using executing-plans and TDD; no new agents. User authorized
autonomous improvement and commits/pushes only to the fork main.

## Design

Use the existing fence/frontmatter-aware task extractor for both discovery and
mutation. Reject an ambiguous taskId instead of taking the first match; an
explicit line may address one task after a current revision read. Both list and
update exclude moderation-hidden notes, independent of their folders. List
items carry the revision of the exact raw bytes parsed into their text/line/ID.
Keep five fixed MCP tools and the existing bounded task-list projection.

Compared with patching the second fence state machine, sharing the extractor
removes the cause of divergent semantics. New task storage or an Obsidian
extension would conflict with ordinary Markdown authority and is unnecessary.
This does not promise a vault-wide snapshot, cross-process CAS, pagination of
the entire inventory, or memory-bounded parsing of arbitrary-size files.

## Tasks

- [x] In src/checkbox-task-consistency.test.ts, reproduce hidden-owner listing,
  duplicate block ID selection, and line edits inside fences after a real task.
  Assert original bytes and no mutation notification after rejection. Add revision
  provenance, hidden update, legitimate line update and concurrent stale-guard tests.
- [x] In src/filesystem.ts filter parsed moderation state before task aggregation;
  attach this.revision(content). In updateTask extract once, require one taskId
  match (or exact line match), and calculate the checkbox offset only on that line.
  Check hidden state and the revision of the read note before no-op or mutation.
- [x] Extend TaskItem's listing provenance in src/types.ts and public tool prose
  in src/createServer.ts. Keep parser callers compatible with optional revision.
  Add a public MCP integration proving hidden text/count exclusion and usable
  revision receipts under maxChars/prettyPrint, plus exact rejection of ambiguous IDs.
- [x] Run targeted tests, build, full tests, and isolated compiled MCP smoke.
  Update README/schema/roadmap and diff-check. Publish generated dist with
  source/tests to the authorized fork main and verify SHA separately afterward.

## Evidence

- Baseline: four of five new direct tests failed (hidden aggregate, duplicate
  block-ID mutation, fenced line fallback, hidden-owner mutation). Concurrent
  revision guard was already correct and retained as regression coverage.
- After repair: six new direct/public MCP cases passed. Combined filesystem
  target run: 184 passed, one skipped. Build passed.
- Full suite: 1134 passed, one skipped across 78 files, 48.49 seconds.
- Compiled MCP smoke: anonymous listing excluded hidden task text/path/count;
  pretty JSON stayed within 1200 characters and included source revisions.
  Ephemeral registration, ambiguous-ID rejection, explicit-line success, exact
  Markdown reread and refreshed listing revision all passed. Client/server
  closed and the validated owned temp fixture/account was removed.
- Inline review confirms shared parsing removes the second fence state machine;
  list counts filter hidden state before aggregation, and the exact read revision
  is checked before no-op as well as mutation. No added MCP tool or client setup.
- Pending work outside this batch: broad scan memory/IO bounds, stable pagination,
  cross-process read/write races, and complete Obsidian-renderer equivalence.
