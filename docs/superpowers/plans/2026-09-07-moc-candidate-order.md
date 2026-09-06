# Faithful MOC Candidate Order Implementation Plan

> Execute inline with executing-plans and TDD. User already approved design
> decisions and publishing solely to the fork main.

**Goal:** Preserve authored priority and identical bounded MOC memberships.
**Architecture:** Existing fresh bounded sample -> sort -> first12 -> identical
metadata/draft projections -> existing envelope and revision checks.
**Tech Stack:** TypeScript, real temporary filesystem fixtures, Vitest.

- [x] Add tests in src/moc-candidate-snapshot.test.ts using the existing fixture.
  Seed 14 notes with the last note nav_order:0 and others nav_order:10;
  graphHealth returns their actual revisions. Assert orderedEntries[0].path
  equals that late note and length is12. Reverse sample arrival; assert equal
  notePaths. Parameterize 9/12/14 entries: draft extracted targets must equal
  notePaths and orderedEntries paths; entryTotal equals sample count and
  entriesTruncated equals count>12. notes.write content must equal draft.
- [x] Run `npm test -- src/moc-candidate-snapshot.test.ts --maxWorkers=1` RED.
- [x] In src/llm-wiki.ts remove the pre-sort entries.length<12 admission guard;
  retain the entry metadata construction. After the existing group.entries.sort
  call, execute `group.entries.splice(12)`. Generate links with
  `group.entries.map` instead of `group.entries.slice(0, 8).map`. Include
  `entryTotal: group.entryTotal` beside entriesTruncated in each output item.
- [x] Re-run candidate/safe-link/population/reference focused suites GREEN.
  Update README.md, _wiki/SCHEMA.md and llm-wiki-tools.ts progressive guidance
  with sample-local order and identical selected memberships.
- [x] Run npm run build, npm test -- --maxWorkers=1 and diff check. Record
  exact evidence; inspect generated diff and contract coverage.
- [x] Commit explicit source/tests/docs/dist only, push origin main and verify
  HEAD/origin/main equality. Preserve unrelated .agents/ and .mcpvault/.

## Evidence

- RED4/26: a late nav_order:0 note and the next title-ranked member were dropped;
  9/12/14-member drafts silently omitted their ninth and later links.
- GREEN80 tests/5 focused files, including reverse-arrival equality, full
  membership projections, creation-content equality, sample totals and budgets.
- Build exit0 and diff check passed. Independent Luna read-only review and full
  single-worker suite in progress; no live Vault/server/client changes.
- Final evidence: Luna read-only review returned no findings and was closed.
  Generated dist mirrors source. Full single-worker suite2713 passed, 1 skipped,
  176 files, 323.85s, exit0. Build and final diff check exit0. All four new tests
  were observed failing before implementation, then passing with the fix.
- Implementationf62c82f pushed to Song-Seng-Hun/mcpvault main; HEAD and
  origin/main match. Only unrelated .agents/ and .mcpvault/ remain untracked.
