# Graph refresh integrity implementation plan

> Execute inline with executing-plans and TDD; do not spawn agents or modify the live Vault.

**Goal:** Graph navigation must not lose observed invalidations or publish known obsolete refresh results; bulk refresh I/O must stay bounded.

**Architecture:** Route standalone watcher and catalog reset events through existing invalidation methods. Stage graph entries/path sets, publish only a generation-stable refresh, and retry observed drift at most three rounds per request. Keep new events pending on failure. Batch dirty source reads like full refresh, and reuse shared bounded source reading with an 8 MiB per-note ceiling.

**Tech stack:** TypeScript, Node filesystem, Vitest, VaultIoCoordinator.

## Design decisions

- Keeping the old best-effort refresh loses known changes. Unbounded retry can starve requests. Choose bounded stabilization with a generic retry error that reveals no paths or private metadata.
- New note watcher events must update path membership as well as parsed entries; deletions remove both. Unknown/full invalidations require content rereads, not just equal size/mtime reuse. Periodic reconciliation may retain the existing metadata shortcut for unchanged notes.
- Pending explicit path changes bypass metadata reuse during a full refresh. An invalidation arriving during a read must survive and prevent that intermediate result from being returned.
- Source-size errors must not become empty successful graphs or retain a silently usable obsolete view. This can make graph queries unavailable until an oversized source is split; it does not terminate the MCP server. No source paths are exposed by errors.
- Batch width 16 caps scheduled dirty reads, not total graph memory. Full inventory, parsing/edge storage and watcher delivery reliability remain limitations. This is not cross-process atomic filesystem snapshotting.

## Implementation steps

- [x] Add `src/graph-refresh-integrity.test.ts` with deterministic filesystem watcher delivery and injected I/O gates: new-note membership, unknown invalidation during full read, second invalidation during dirty read, equal-metadata full reset, excessive churn, oversized source rejection/recovery, bounded dirty dispatch.
- [x] Run targeted tests and establish failures against current code. Update `src/vault-graph.ts` refresh state and read path; retain existing graph query contracts and permission filters.
- [x] Run graph/moderation/tag/mutation/storage tests and build/full suite; document retry behavior and limits in README, schema and roadmap.
- [x] Exercise compiled MCP against an isolated fixture.

Delivery uses a source+generated-dist commit and authorized fork-main push; the
Git command results and matching remote SHA are the external delivery evidence.

## Verification / inline review

- Seven deterministic baseline regressions failed as intended. An additional
  shared-catalog test exposed a notification waiting in debounce during IO; it
  passed after adding a post-read catalog barrier. No sleeps or live Vault used.
- The existing storage-failure injector was updated to cover `open` as well as
  `readFile`; all original redaction, repeated-failure and recovery assertions
  remain. Graph failure tests must exercise the real bounded-reader path.
- Build passed. Full suite: 1167 passed, 1 skipped, 84 files, 59.92 seconds.
  `git diff --check` passed. Inline review covered generation guards, allPaths
  publication, retained pending paths, source cap, failed-batch draining and
  unchanged scope/moderation filtering. No reviewer agent was spawned.
- Compiled MCP: oversized source rejected with a short path-redacted error,
  server retained five tools, and repairing the fixture source recovered the
  same running server without restart. Temporary fixture was removed.
- Remaining limits are explicit above; successful tests are not evidence of
  whole-vault atomic snapshots, hard global memory limits or perfect OS events.
