# Shared HTTP behavior verification after Codex restart

## Scope

The transport cutover is verified separately in
`2026-09-07-live-shared-http-cutover.md`. This increment tests whether independent
clients using that shared runtime observe current data and revision conflicts.
It is regression coverage for existing behavior, not a new production fix.

Tests use actual MCP SDK clients and the HTTP adapter over a disposable temporary
Vault. Constructor witnesses subclass real services without replacing their
behavior. No live Vault accounts, notes or posts are created. The fixture closes
clients, listeners and owners, validates the temporary path, and removes its
disposable files. Lexical search explicitly disables semantic inference.

## Added checks

- Four clients warm empty search results before creating a note. All see the
  created path; compact search JSON fits the requested 512-character budget
  despite a longer Korean-containing body.
- A different client reads the revision; another replaces the body using that
  revision. Every client sees the new revision and new term, not the old term.
- Deletion uses the preview and exact path confirmation, moving to local trash.
  Every client stops seeing the deleted path in search results and receives a
  not-found error when reading it directly.
- Two clients concurrently write different bodies with the same revision.
  Exactly one succeeds and the other reports a revision conflict; both
  subsequently read that winner's content and a new revision.
- Each scenario constructs one catalog, metadata, graph, search and semantic
  service bundle, not one per request or per client.

The tests passed before any production change, so no production code or
generated runtime change was needed. Existing tests separately cover private
scope isolation, token revocation, discovery changes and process lifecycle.

## Evidence and limits

- Baseline HTTP ownership/lifecycle: 2 files, 13 tests passed (13.66 seconds).
- Added coverage: runtime-sharing file, 8 tests passed (6.20 seconds).
- Initial build and full suite passed: 194 files, 2,979 passed / 2 skipped
  (2,981 total), 394.29 seconds, starting 11:36:48 local on 2026-09-07.
- Independent Luna review identified missing explicit assertions for conflict
  reason and direct read-after-delete failure. Both were added. The review
  worker was closed. The initial full-suite result above predates these
  additional assertions.
- Final strengthened file: 8 tests passed (6.46 seconds); subsequent build
  passed. Final full suite: 194 files, 2,979 passed / 2 skipped (2,981 total),
  390.26 seconds, starting 11:45:08 local on 2026-09-07, exit 0. Both full runs
  used one worker. `git diff --check` passed.

These checks do not measure RSS, VRAM, event-loop delay, throughput or p95
latency. They do not exercise native model loading, external-editor watcher
latency, graph traversal freshness or all possible cache combinations. A small
same-workload stdio-versus-HTTP benchmark remains the next measurement task;
constructor counts are not a substitute for that benchmark.
