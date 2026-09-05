# Bounded tag discovery implementation plan

> Execute inline with executing-plans. No new agents, live Vault changes, or upstream contributions.

**Goal:** Make every visible tag discoverable without unbounded responses or silently losing the tail of a list.

**Architecture:** Keep the existing graph/filesystem array contract and visibility filtering. A public response helper projects that array into `{tags,total,returned,offset,snapshotFingerprint,truncated,nextAction}`. The same dynamic endpoint is used; no new MCP tool or compatibility list.

**Tech stack:** TypeScript, Node crypto, Vitest, in-memory MCP client.

## Design and trade-offs

Full arrays exhaust context; truncation without continuation hides classifications. Choose deterministic count-descending/ordinal-tag ordering and guarded offset pagination. An optional lowercase prefix (leading # removed) selects a literal tag prefix. Counts remain occurrences, not distinct notes. Default limit 50, ceiling 200; maxChars 4000, range 512–12000 including JSON formatting.

Hash the normalized prefix and ordered visible tag/count tuples. Positive offsets require the returned fingerprint; changed counts, labels or filter reject continuation. This is a derived view guard, not authentication, a source revision, or an atomic graph snapshot. Hidden-only changes must not perturb public results. Reapply permissions on every call.

Preserve exact identifiers, select only a fitting contiguous prefix, and advance by actual emitted items. If one item cannot fit, return a bounded retry reusing original arguments with maxChars 12000, limit 1, prettyPrint false. At that ceiling fail explicitly without skipping. Never echo tokens. Existing full aggregation and sorting costs remain; this is not a constant-memory index redesign.

## Steps

- [x] Add public MCP tests in `src/tag-page.test.ts`: bounded complete traversal, normalized prefix, invalid/stale continuation, oversized exact labels, private/moderated exclusion. Run `npm test -- src/tag-page.test.ts` and confirm missing-page failures.
- [x] Create `src/tag-page.ts` with validation, deterministic snapshot and exact JSON packing. Wire schema/dispatcher in `src/createServer.ts`; retain internal service output. Adapt public assertions in markdown-tags, graph-moderation-view, scope-security and tag-mutation-integrity tests to `.tags`.
- [x] Test deterministic snapshot changes and ceiling behavior, run nearby tests, update README/schema/roadmap with the public envelope, nextAction protocol and advisory-view limits.
- [x] Run `npm run build`, full `npm test`, `git diff --check`, and compiled MCP fixture smoke with bounded multi-page traversal.
- [ ] Commit source/tests/docs/dist together and push only verified fork main; compare remote SHA (external completion evidence is the Git command result).

## Verification and inline review

- Baseline: three new public tests failed because the array had no page contract.
- Review caught a misplaced schema hunk before integration; a new discovery regression failed, then passed after correction. The tag descriptor, not Git status, now declares the new inputs.
- Full suite: 1158 passed, 1 skipped, 83 files, 54.15 seconds. Build and whitespace validation passed.
- Compiled `dist/src/createServer.js`: isolated Vault traversal returned 90 exact tags once across seven 1200-character pages; five fixed tools remained. Reopening after a hidden-only source change preserved the public fingerprint. Temporary fixture removed; no live Vault writes/restart.
- Existing authenticated tag mutation test verifies immediate fingerprint change and stale continuation rejection after the normal revision-checked write and re-read.
- Remaining limits: full graph aggregation, eventual external-change reconciliation, process-wide memory and cross-process snapshot atomicity. No independent reviewer agent was spawned during cleanup-sensitive work.
