# MOC Rebalance Coherence Implementation Plan

> Inline executing-plans/TDD; independent integrity review. Design approval and
> fork-main publishing are already delegated by the user.

**Goal:** Trustworthy bounded split proposals without divergent projections.
**Architecture:** bounded root -> syntax-aware lookup -> request-local exact
metadata cache -> safe draft -> coherent trimming -> bounded snapshot recheck.
**Tech Stack:** existing filesystem/scope helpers, TypeScript, Vitest.

- [ ] Create src/moc-rebalance-coherence.test.ts with a real temporary fixture.
  Seed four linked notes and one MOC; assert relative Markdown chooses the
  intended path over a root namesake. Test private draft links are physical and
  exact. Spy readNoteMetadata/readNoteRevision only for deterministic drift
  hooks; validate actual file hashes. Test member, relation, destination edits
  after admission reject; hidden collision remains not-visible with missing
  expectedRevision. Exercise budgets700..16000 and draft/entry agreement.
- [ ] Run new suite with --maxWorkers=1 and observe RED before source changes.
- [ ] In src/llm-wiki.ts extract proposalDocumentLink(target,source) and
  proposalDisplayText(text) from mocCandidates without changing its behavior.
  In mocRebalance use `readNote(path, MAX_NOTE_CONTENT_BYTES)` and fresh strict
  `readNoteMetadata([path],canAccess,{fresh:true,strict:true,maxBytes:...})`,
  request-local cache<=256. Syntax selects findPathForMarkdownLink(target,path,
  canAccess) or findPathForWikiLink(target,canAccess,path).
- [ ] Replace member/relation reads and noteExists with that metadata lookup.
  Build parent property from a validated physical exact wikilink; fallback is
  a parentLinkWarning plus safe Markdown navigation, not malformed Properties.
  Render one branch draft function using selected entries; rerun it after pop.
  Filter dependency endpoints to surviving branch.entries after truncation.
  Call assertCurrentContextSources with root+visible cache snapshots, max257,
  and MAX_NOTE_CONTENT_BYTES on both normal and compact return paths.
- [ ] Targeted GREEN includes candidate, encoded Markdown, MOC-reference and
  legacy rebalance integration tests. Update README/_wiki schema/tool guidance.
- [ ] Build dist; independent integrity review; full npm test -- --maxWorkers=1;
  git diff --check. Record exact results and any failures/fixes.
- [ ] Explicit-file commit and push only origin main, verify HEAD/origin/main.
  Preserve unrelated .agents/ and .mcpvault/. No actual Vault or server actions.
