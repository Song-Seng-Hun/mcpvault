# Faithful MOC Candidate Order Implementation Plan

> Execute inline with executing-plans and TDD. User already approved design
> decisions and publishing solely to the fork main.

**Goal:** Preserve authored priority and identical bounded MOC memberships.
**Architecture:** Existing fresh bounded sample -> sort -> first12 -> identical
metadata/draft projections -> existing envelope and revision checks.
**Tech Stack:** TypeScript, real temporary filesystem fixtures, Vitest.

- [ ] Add tests in src/moc-candidate-snapshot.test.ts using the existing fixture.
  Seed 14 notes with the last note nav_order:0 and others nav_order:10;
  graphHealth returns their actual revisions. Assert orderedEntries[0].path
  equals that late note and length is12. Reverse sample arrival; assert equal
  notePaths. Parameterize 9/12/14 entries: draft extracted targets must equal
  notePaths and orderedEntries paths; entryTotal equals sample count and
  entriesTruncated equals count>12. notes.write content must equal draft.
- [ ] Run `npm test -- src/moc-candidate-snapshot.test.ts --maxWorkers=1` RED.
- [ ] In src/llm-wiki.ts remove the pre-sort entries.length<12 admission guard;
  retain the entry metadata construction. After the existing group.entries.sort
  call, execute `group.entries.splice(12)`. Generate links with
  `group.entries.map` instead of `group.entries.slice(0, 8).map`. Include
  `entryTotal: group.entryTotal` beside entriesTruncated in each output item.
- [ ] Re-run candidate/safe-link/population/reference focused suites GREEN.
  Update README.md, _wiki/SCHEMA.md and llm-wiki-tools.ts progressive guidance
  with sample-local order and identical selected memberships.
- [ ] Run npm run build, npm test -- --maxWorkers=1 and diff check. Record
  exact evidence; inspect generated diff and contract coverage.
- [ ] Commit explicit source/tests/docs/dist only, push origin main and verify
  HEAD/origin/main equality. Preserve unrelated .agents/ and .mcpvault/.
