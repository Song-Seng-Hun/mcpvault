# Semantic Chunk Reuse Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution with a narrow
> independent final review; preserve the user's explicitly approved main branch.

**Goal:** Reuse unchanged same-note vectors without relaxing scope or revision checks.

**Architecture:** Store two fingerprints in existing LanceDB rows. A small profile
module identifies the pinned inference contract; the semantic service performs
bounded lookups and embeds misses. Manifest identity drives gradual upgrades.

**Tech Stack:** TypeScript, Node, Transformers.js, LanceDB, Vitest.

## Steps

- [x] In `src/semantic-reuse.test.ts`, build real temporary DB/Markdown fixtures,
  substitute `embedMany` only, exercise `prepareIndex`/`applyIndexBatch`, and
  assert `expect(embeddedInputs).toHaveLength(0)` after a Properties-only change.
  Run `npm test -- src/semantic-reuse.test.ts --maxWorkers=1`; require RED.
- [x] Add `src/semantic-profile.ts` for the pinned model and SHA-256 profile.
  Fingerprint `JSON.stringify({model, revision, runtimeVersions, dtype:'q8',
  device:'cpu', pooling:'mean', normalize:true, dimensions:384, prefix:'v1'})`.
  Resolve installed runtime metadata without importing inference; if unavailable,
  use a per-process nonce instead of trusting a cross-process identity.
- [x] In `src/semantic-search.ts`, pin loading and disable unversioned local model
  shadowing. Query only current-profile rows. Make legacy manifest profiles stale,
  migrate missing nullable row columns before writes, and load only same-path,
  same-profile rows with `.limit(65)` and explicit selected columns.
- [x] Hash each current passage input; accept only 384 finite numeric values.
  Embed miss batches, recreate every locator/revision, keep late source hash guard.
  Run the focused test until GREEN; add RED/GREEN cases for partial/reordered edits,
  malformed vectors, overflow, lookup failure, scope isolation and source races.
- [x] Verify real table column migration, restart reuse, model-profile mismatch
  and legacy-stat-equal scan behavior. Test pipeline options through a mocked
  inference module, never download a model. Update old integrity fixtures with
  current profiles while preserving their existing locator/security assertions.
- [x] Update README with gradual rebuild, pinned-cache download caveat and exact
  measured input counts. Run `npm run build`, `npm test -- --maxWorkers=1` and
  `git -c core.safecrlf=false diff --check`; collect final narrow review.
- Final integration uses only owned source/tests/docs/generated dist and
  `origin main` after checking the fork URL; Git history records its outcome.
  Both review workers have been closed.

## Verification log

- Initial four real-LanceDB reuse tests failed because every chunk was still
  embedded. GREEN verified after implementation. A test fixture needed Float32
  values to match LanceDB's real vector storage; no precision change was made
  to production.
- Five upgrade/profile tests then failed for missing migration, stat-equal legacy
  entries not queued, profile not persisted, and mixed-profile query results.
  All nine tests passed after those fixes.
- Added bounded/corrupt lookup, SQL quoting, different scopes/notes, all-reuse
  source race, and pinned-pipeline/cross-process fingerprint controls. Updated
  existing native test doubles to supply profile/schema/where methods while
  preserving previous integrity assertions. Focused total: 68 tests across five
  files passed in 8.15 seconds, with one worker. Build passed.
- Independent migration/integrity review found no important issues and was
  closed. Main follow-up reproduced a model-free DB idle-release gap with two
  failing tests; shared resource cleanup now also starts from DB access and
  waits for active queries/indexing. Both tests pass. The first full-suite run
  was explicitly cancelled for this fix and is not verification.
- Final lifecycle re-review found no concrete major regression and was closed.
  Focused verification passed 71 tests across five files; build and diff check
  passed. Fresh full suite: `npm test -- --maxWorkers=1` passed 2,300 tests with
  one existing skip across 151 files in 283.43 seconds. No live server restart,
  Vault write, GPU run or actual embedding model download was performed.

This completes the approved chunk-reuse increment, not the entire organization
goal. Streaming snapshots, queue-complexity improvements and measured CPU/GPU
comparisons remain separate potential work, not claimed implemented here.
