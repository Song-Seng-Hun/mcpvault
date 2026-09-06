# MOC Rebalance Coherence Implementation Plan

> Inline executing-plans/TDD; independent integrity review. Design approval and
> fork-main publishing are already delegated by the user.

**Goal:** Trustworthy bounded split proposals without divergent projections.
**Architecture:** bounded root -> syntax-aware lookup -> request-local exact
metadata cache -> safe draft -> coherent trimming -> bounded snapshot recheck.
**Tech Stack:** existing filesystem/scope helpers, TypeScript, Vitest.

- [x] Create src/moc-rebalance-coherence.test.ts with a real temporary fixture.
  Seed four linked notes and one MOC; assert relative Markdown chooses the
  intended path over a root namesake. Test private draft links are physical and
  exact. Spy readNoteMetadata/readNoteRevision only for deterministic drift
  hooks; validate actual file hashes. Test member, relation, destination edits
  after admission reject; hidden collision remains not-visible with missing
  expectedRevision. Exercise budgets700..16000 and draft/entry agreement.
- [x] Run new suite with --maxWorkers=1 and observe RED before source changes.
- [x] In src/llm-wiki.ts extract proposalDocumentLink(target,source) and
  proposalDisplayText(text) from mocCandidates without changing its behavior.
  In mocRebalance use `readNote(path, MAX_NOTE_CONTENT_BYTES)` and fresh strict
  `readNoteMetadata([path],canAccess,{fresh:true,strict:true,maxBytes:...})`,
  request-local cache<=256. Syntax selects findPathForMarkdownLink(target,path,
  canAccess) or findPathForWikiLink(target,canAccess,path).
- [x] Replace member/relation reads and noteExists with that metadata lookup.
  Build parent property from a validated physical exact wikilink; fallback is
  a parentLinkWarning plus safe Markdown navigation, not malformed Properties.
  Render one branch draft function using selected entries; rerun it after pop.
  Filter dependency endpoints to surviving branch.entries after truncation.
  Call assertCurrentContextSources with root+visible cache snapshots, max257,
  and MAX_NOTE_CONTENT_BYTES on both normal and compact return paths.
- [x] Targeted GREEN includes candidate, encoded Markdown, MOC-reference and
  legacy rebalance integration tests. Update README/_wiki schema/tool guidance.
- [x] Build dist; independent integrity review; full npm test -- --maxWorkers=1;
  git diff --check. Record exact results and any failures/fixes.
- [ ] Explicit-file commit and push only origin main, verify HEAD/origin/main.
  Preserve unrelated .agents/ and .mcpvault/. No actual Vault or server actions.

## Review-driven additions and evidence

- Initial10 RED. Core fixes9 GREEN; six sequential budget cases exceeded the
  default5s test timeout, so split them into independent parameterized cases
  (no timeout relaxation). Focused59/4 files then passed.
- Added hiding/deletion/root drift, metadata256cap and in-memory MCP tests.
  Removed the cap temporarily for RED proof, then restored it. Suite20 passed.
- Independent Astra review found Windows separator rendering, root-basename
  ambiguity, long-path fallback overflow and resolver-internal unbounded scans.
  Real long-path RED742>700; Windows/root-link and missing resolver RED3.
- Added FileSystemService.createNoteReferenceResolver instead of calling the
  standalone per-link whole-Vault fallback. Unindexed path resolution reads no
  bodies; aliases share the admission cache. Rebalance filters fresh visibility
  before ambiguity. Shared proposal rendering uses exact relative root links;
  candidate tests now assert resolved identities, including nested namesakes.
  Scope and alias-injection expectations were updated from syntax to identity.
- Focused68/4 files and legacy organization/rebalance2 tests passed; build passed.
- Follow-up review found indexed alias drift before metadata admission. Two
  real VaultMetadataIndex tests failed before an admitted-descriptor identity
  recheck was added. This verifies observed candidates, not global atomic
  ambiguity against all concurrent new aliases. Final delta review and full
  suite results are recorded below. No actual Vault/server/client changes.
- Identity guard GREEN:70 tests/4 files. Final delta review no further findings;
  reviewer closed. Build exit0.
- First full suite:2738 passed, 1 skipped, 1 failure (177 files,343.50s).
  Failure was the existing createServer semantic fallback test's5000ms timeout,
  not an assertion. Unchanged isolated retry passed in545ms. Root cause is not
  established; no timeout/assertion was relaxed.
- Unchanged whole-file retry: createServer.test.ts,41 passed,14.48s,exit0.
- Final full recheck:177 files passed;2739 passed,1 skipped (2740),313.88s,
  exit0. Started2026-09-07 04:06:44 local. This demonstrates a passing retry,
  not a proven fix for the earlier intermittent timeout.
