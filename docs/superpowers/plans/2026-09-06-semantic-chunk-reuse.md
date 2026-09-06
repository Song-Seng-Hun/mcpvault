# Semantic Chunk Reuse Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution with a narrow
> independent final review; preserve the user's explicitly approved main branch.

**Goal:** Reuse unchanged same-note vectors without relaxing scope or revision checks.

**Architecture:** Store two fingerprints in existing LanceDB rows. A small profile
module identifies the pinned inference contract; the semantic service performs
bounded lookups and embeds misses. Manifest identity drives gradual upgrades.

**Tech Stack:** TypeScript, Node, Transformers.js, LanceDB, Vitest.

## Steps

- [ ] In `src/semantic-reuse.test.ts`, build real temporary DB/Markdown fixtures,
  substitute `embedMany` only, exercise `prepareIndex`/`applyIndexBatch`, and
  assert `expect(embeddedInputs).toHaveLength(0)` after a Properties-only change.
  Run `npm test -- src/semantic-reuse.test.ts --maxWorkers=1`; require RED.
- [ ] Add `src/semantic-profile.ts` for the pinned model and SHA-256 profile.
  Fingerprint `JSON.stringify({model, revision, runtimeVersions, dtype:'q8',
  device:'cpu', pooling:'mean', normalize:true, dimensions:384, prefix:'v1'})`.
  Resolve installed runtime metadata without importing inference; if unavailable,
  use a per-process nonce instead of trusting a cross-process identity.
- [ ] In `src/semantic-search.ts`, pin loading and disable unversioned local model
  shadowing. Query only current-profile rows. Make legacy manifest profiles stale,
  migrate missing nullable row columns before writes, and load only same-path,
  same-profile rows with `.limit(65)` and explicit selected columns.
- [ ] Hash each current passage input; accept only 384 finite numeric values.
  Embed miss batches, recreate every locator/revision, keep late source hash guard.
  Run the focused test until GREEN; add RED/GREEN cases for partial/reordered edits,
  malformed vectors, overflow, lookup failure, scope isolation and source races.
- [ ] Verify real table column migration, restart reuse, model-profile mismatch
  and legacy-stat-equal scan behavior. Test pipeline options through a mocked
  inference module, never download a model. Update old integrity fixtures with
  current profiles while preserving their existing locator/security assertions.
- [ ] Update README with gradual rebuild, pinned-cache download caveat and exact
  measured input counts. Run `npm run build`, `npm test -- --maxWorkers=1` and
  `git -c core.safecrlf=false diff --check`; collect final narrow review.
- [ ] Stage only owned source/tests/docs/generated dist; commit and push only
  `origin main` after checking the fork URL. Close the review worker.
