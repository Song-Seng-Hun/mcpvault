# MOC Candidate Snapshot Implementation Plan

> Execute inline using TDD; integrity review by a scoped independent agent.
> Design and fork-main integration already authorized by the user.

**Goal:** Make MOC proposals revision-coherent and scope-local without a second
whole-Vault query pass.
**Architecture:** Graph source stamps -> bounded fresh metadata -> scoped groups
-> safe draft/collision plan -> final snapshot validation -> bounded envelope.
**Tech Stack:** TypeScript, existing filesystem/scope/context helpers, Vitest.

- [x] Add src/moc-candidate-snapshot.test.ts: controlled graph-then-edit/hide/
  delete tests; scope family matrix; untrusted alias/domain link injection;
  fresh collision behavior; final-read drift; source bytes; complete envelopes.
  Run `npm test -- src/moc-candidate-snapshot.test.ts --maxWorkers=1` for RED.
- [x] Stamp uncoveredKnowledge rows from graphByPath revision. Add an exact
  graph-to-candidate equality test against the real file revision.
- [x] Replace mocCandidates second iterateNotes scan with resolved uncovered
  snapshots and one fresh/strict bounded readNoteMetadata call. Reject invalid
  revisions and non-matching/missing/hidden results. Use only checked metadata.
- [x] Partition groups by canvasScopeRoot plus basis. Build destinations with
  joinRoot; retain API public paths but generate physical-path Obsidian links.
  Escape display text; fallback to percent-encoded relative Markdown paths.
- [x] Inspect visible destination metadata, preserve expectedRevision:missing
  on creation, validate returned snapshots through assertCurrentContextSources.
  Include graph sampling partialness; trim full envelope without losing bounds.
- [x] Update README/_wiki schema/tool guidance. Focused tests, build, independent
  review, full `npm test -- --maxWorkers=1`, diff check.
- [x] Commit explicit source/tests/docs/dist, push origin main, verify hashes.

## Evidence

- Initial candidate RED11 failures/5 passes: input drift, duplicate scan, private
  scope admission/grouping, draft injection, hidden collisions and partialness.
- Candidate GREEN15/16 exposed a shared Markdown parser bug: encoded filename#
  was reparsed as an anchor. Separate parser RED3/5; preserve decoded document
  separately from the literal URL fragment. Five parser tests now green.
- Candidate suite now19 tests, including graph revision equality, partial group
  cap, and real MCP budgets. Five-file focused regression73 passed. Build/diff
  check pass. Independent integrity review and full single-worker suite pending.
- Independent review found child-relative Markdown paths could resolve as Vault
  root paths, and stripped extensions made same-stem note formats ambiguous.
  Added actual filesystem resolution tests; final revision reads also require
  the same byte cap as admission. RED5/22 (including two updated exact-link
  expectations), then GREEN76/5 files after fixes; candidate suite now22 tests.
- The pre-review full-suite run was interrupted; its process is gone and it is
  not counted as verification. A fresh full suite follows the reviewed fixes.
- Delta integrity review returned no additional findings; reviewer closed.
- The first post-review full run exposed a legacy organization-loop assertion
  requiring unsafe alias-style drafts. Stopped that run, reproduced it alone,
  and updated its exact expected link to [[Knowledge/Alpha.md]], preserving all
  other workflow assertions. Neither interrupted full run counts as a pass.
- Final verification: focused76/5 files passed; organization-loop assertion
  passed after updating its expected draft; npm run build exit0; independent
  delta review no further findings; full single-worker suite2709 passed,
  1 skipped, 176 files, 337.24s, exit0. Diff check passed. No live Vault mutation,
  runtime restart, new service, or extra client installation. This removes the
  duplicate candidate metadata scan; no RAM/latency improvement percentage is
  claimed without a workload benchmark.
- Implementation485a720 pushed to Song-Seng-Hun/mcpvault main; HEAD and
  origin/main match. Only unrelated .agents/ and .mcpvault/ remain untracked.
