# Query visibility and hydration integrity

**Goal:** Public query rows, totals and cursors use the same visibility predicate; hydrated bodies must belong to the revision/metadata that selected them.

**Architecture:** Add a request-local row predicate to filesystem query and indexed page selection. Public MCP/REST query supplies folder-independent moderation visibility before pagination; internal callers keep their explicit/default policy. Shared sorted caches stay caller-independent; per-request predicates apply before heap/offset/count decisions. Body hydration compares the selected revision with the actual raw read. Drift/absence rejects the whole page with a path-free query-change error, and IO failure is unavailable rather than empty success. No global disk lock or retained snapshot is introduced.

**Execution:** Inline, no new agents, existing autonomous fork-only authorization. Use TDD and verification-before-completion.

- [x] Add real public MCP regression tests for Knowledge/Community hidden rows, count/page-only selection, cursors, and includeContent. Verify unindexed predicate/offset parity and unchanged internal defaults.
- [x] Reproduce stale revision/body pairing and swallowed hydration IO using controlled post-selection file edits/failures.
- [x] Add row predicate to `src/filesystem.ts` query and `src/vault-index.ts` listSortedPage; apply before both heap and large-offset sort paths. Remove adapter post-filter.
- [x] Share checked hydration across indexed paths; eliminate the unreachable second page-only branch. Keep storage failures distinct from confirmed missing paths and snapshot drift.
- [x] Update schema/README/roadmap with exact advisory snapshot and retry semantics. Verify targeted/index suites, build, full tests, compiled public smoke and diff check.

## Verification and handoff

- Initial seven regressions failed before the main fix. A later unindexed
  `includeTotal:false` assertion reproduced total=2 instead of -1/unknown;
  the fallback now uses the same response contract.
- Targeted query/index/filesystem: 192 passed, one skipped; expanded public
  query suite: 11 passed, including whole-page rejection with a successful row
  preceding the changed one.
- Full-suite first run exposed a pre-existing invalid test constructor:
  catalog-read-barrier supplied VaultFileCatalog as the IO coordinator. Its
  TypeError had been swallowed by query hydration. Corrected the fixture to use
  the real default reader, without weakening the dashboard assertions.
- Final build passed. Final full suite: 1,047 passed, one skipped, 67 files,
  44.83 seconds. Compiled dist MCP smoke passed visible totals, page-only body
  reads and a post-selection hidden edit rejection within the response budget.
- Inline review verified predicate placement in both page-selection paths,
  unindexed parity, preserved internal visibility defaults and path-free errors.
  `git diff --check` passed. Stage source/tests/docs and generated dist together;
  delivery target is only Song-Seng-Hun/mcpvault main, never an upstream PR.

## Not claimed

Metadata-only queries still use a refreshed read model, not raw rereads of every note. Cursor sequences do not retain a vault-wide snapshot across independent requests. Graph/aggregate visibility and multi-file transactional audits remain separate. Oversized-page serialization/cursor recovery and hydration byte budgets remain explicit open work in the organization roadmap; these small-row tests do not prove them. Live-server restart/deployment is not implied by a compiled isolated-vault smoke test.
