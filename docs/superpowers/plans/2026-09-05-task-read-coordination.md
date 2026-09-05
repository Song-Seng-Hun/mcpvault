# Task read coordination implementation plan

Inline executing-plans/TDD; autonomous fork-main work authorized. No new agents.

## Design

Task inventory already retains only its requested page but bypasses VaultIoCoordinator
and constructs a complete per-note task array. Route it through the existing shared
bounded reader with an 8 MiB source ceiling (same as supported note writes). Concurrent
identical reads can coalesce; there is no persistent content cache or added index.
Oversized input fails before partial parsing/counts and gives a generic pathPrefix
narrowing hint without exposing the unparsed source's path or contents. Existing
storage and snapshot-drift failures remain explicit. Hidden/unauthorized filtering
still precedes aggregation; unreadable moderation cannot be guessed from partial YAML.

Refactor markdown-tasks.ts to export a lazy iterateMarkdownTasks generator; preserve
extractMarkdownTasks as the array adapter for existing callers. Iterate source lines
without split and keep the exact existing frontmatter/fence/identity semantics. List
scans the generator for count/hash and keeps at most the selected page. This reduces
allocation, not the need for a complete scan or normalized duplicate-identity map.

Alternatives: another persistent task index adds invalidation obligations; a total
scan cutoff would strand ordinary large inventories without scan continuation.
Reuse coordination plus bounded source/lazy extraction first; do not claim constant
cost pages, cross-process snapshots, or aggregate process-memory guarantees.

## Tasks

- [x] Add tests for actual bounded-reader coalescing across concurrent listTasks,
  a new disk read after completion/external edit, and oversized source rejection.
  Verify baseline bypasses the reader and accepts the oversized source.
- [x] Route listTasks through vaultIo.readUtf8Bounded and preserve the existing
  SourceReadLimitError classification (no storage-failure throttling). Map that
  limit to a generic inventory-specific error without returning a partial total.
- [x] Refactor iterator with frontmatter, matching fences, CRLF, block IDs and
  duplicate-content identity parity tests. Keep updateTask using the shared parser.
- [x] Build/full tests, compiled isolated MCP smoke and bounded error check;
  docs/roadmap and diff-check. Publish generated dist/source/tests and verify
  fork-main SHA separately after verification.

## Evidence

- Baseline: both IO tests failed (zero coordinator requests, oversized source
  accepted). The iterator contract failed because no lazy API existed.
- New direct tests prove two concurrent list requests call the same bounded
  reader once, subsequent reads refresh after external edits, oversized input
  rejects without partial inventory/owner disclosure, and Markdown locations,
  duplicate identities, CRLF and matching fence behavior remain intact.
- Targeted: 198 passed, one skipped. Build succeeded. Full: 1143 passed,
  one skipped across 80 files, 59.75 seconds.
- Differential check against pre-change 8ffca8d dist/src/markdown-tasks.js:
  300 deterministic 45-line cases (LCG seed 5192026) mixed LF/CRLF, frontmatter,
  matching/mismatched fences, Unicode, duplicate task text, IDs and trailing
  newlines. Both the new array adapter and iterator matched old task objects
  exactly, including source line and content-derived ID.
- Compiled MCP smoke: an 8 MiB-exceeding source produced a <=512-character
  error without source identity/body. A scope://global/Small.md retry succeeded;
  a later external edit returned fresh task text/fingerprint. Client/server closed
  and the validated owned fixture was removed. No live Vault or account changes.
- Remaining: every page still scans inventory; normalized occurrence tracking,
  shared queue/global memory budgets and intra-read external races are not solved
  by this change. No persistent task index or client-side daemon was added.
