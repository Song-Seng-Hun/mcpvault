# Release project bodies after validated projection

> Execute inline with TDD and verification. No agents or live Vault changes.

**Goal:** Project planning must not retain all hydrated project bodies until
response construction when it only needs three heading-presence facts.

**Architecture:** Add an optional request-local content consumer to the internal
inventory reader. Run it after path/moderation/revision validation, then retain
metadata only; drain callbacks with their existing 16-read batch. The final
visible-cohort check still governs success. The no-index path consumes selected
bodies without retaining them too. Work snapshots collect only three section
booleans per project. Reuse a shared heading iterator to project either complete
outlines or only explicitly requested heading names.

**Limits:** Complete-source reads, parser line splitting and up to 16 active
sources still use memory. This removes cohort-wide body/heading retention, not
all transient allocations or the metadata/dependency graph's linear space.
The consumer is internal and request-local; discard its results when the read
fails. No persistent index, new tool, background process or client setup.

- [x] Reproduce body retention in work snapshots on indexed/no-index paths.
- [x] Add heading-presence projection sharing the existing fence-aware iterator.
- [x] Consume validated bodies before batch retention; preserve old inventory
  callers that explicitly request content without a consumer.
- [x] Store project section facts separately from authoritative note content and
  use them in projectPacket. Keep body/cohort revision failure checks unchanged.
- [x] Verify consumer failure, hidden exclusion, large heading lists, source
  revisions and output parity; build/full tests/compiled smoke/diff check.
- [ ] Fork-only commit/push, verified separately from local tests.

## Verification

- Before implementation, both indexed/no-index snapshot retention assertions
  failed because `content` was still present. After implementation, the focused
  inventory/planning/heading suite passes all 25 tests.
- `npm run build`: exit 0. Full `npm test`: 1,254 passed, one skipped,
  94 files, 56.80 seconds.
- Compiled isolated fixture: 24 projects with 128 KiB body payload each;
  snapshot retains zero `content` fields and 24 three-boolean section projections.
  Current source revisions remain SHA-256 identifiers. Production MCP exposes
  five tools; registration and `wiki.project_packet` work through `call_endpoint`.
  A 16,000-character page returned 21 rows/15,714 characters; its 512-character
  pretty-format retry used 364 characters. Other-model private content excluded.
- Closed the fixture client/server/index and removed only the verified temporary
  Vault, including its disposable account. No live Vault changes or restart.
- Reviewed consumer call ordering, drained failures, final visible-cohort
  validation, unchanged legacy no-consumer behavior, and shared fence parsing.
  `git diff --check` passes. Delivery is checked against origin/main after commit;
  local verification alone is not proof of push or live-server deployment.

## Remaining costs

No claim of measured heap reduction: parser allocations, active source buffers,
the metadata/dependency cohort, whole-cohort ranking and deepest-chain response
construction remain separate profiling/optimization work.
