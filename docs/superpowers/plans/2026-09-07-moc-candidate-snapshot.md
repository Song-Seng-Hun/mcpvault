# MOC Candidate Snapshot Implementation Plan

> Execute inline using TDD; integrity review by a scoped independent agent.
> Design and fork-main integration already authorized by the user.

**Goal:** Make MOC proposals revision-coherent and scope-local without a second
whole-Vault query pass.
**Architecture:** Graph source stamps -> bounded fresh metadata -> scoped groups
-> safe draft/collision plan -> final snapshot validation -> bounded envelope.
**Tech Stack:** TypeScript, existing filesystem/scope/context helpers, Vitest.

- [ ] Add src/moc-candidate-snapshot.test.ts: controlled graph-then-edit/hide/
  delete tests; scope family matrix; untrusted alias/domain link injection;
  fresh collision behavior; final-read drift; source bytes; complete envelopes.
  Run `npm test -- src/moc-candidate-snapshot.test.ts --maxWorkers=1` for RED.
- [ ] Stamp uncoveredKnowledge rows from graphByPath revision. Update exact
  population-test expectations to require valid revisions, not remove checks.
- [ ] Replace mocCandidates second iterateNotes scan with resolved uncovered
  snapshots and one fresh/strict bounded readNoteMetadata call. Reject invalid
  revisions and non-matching/missing/hidden results. Use only checked metadata.
- [ ] Partition groups by canvasScopeRoot plus basis. Build destinations with
  joinRoot; retain API public paths but generate physical-path Obsidian links.
  Escape display text; fallback to percent-encoded relative Markdown paths.
- [ ] Inspect visible destination metadata, preserve expectedRevision:missing
  on creation, validate returned snapshots through assertCurrentContextSources.
  Include graph sampling partialness; trim full envelope without losing bounds.
- [ ] Update README/_wiki schema/tool guidance. Focused tests, build, independent
  review, full `npm test -- --maxWorkers=1`, diff check.
- [ ] Commit explicit source/tests/docs/dist, push origin main, verify hashes.

## Evidence

Pending tests.
