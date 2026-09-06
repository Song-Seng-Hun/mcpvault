# MOC Coverage Population Implementation Plan

> Execute inline with executing-plans and TDD, then independent scoped review.
> User approved design/main integration; do not access or mutate the live Vault.

**Goal:** Stop valid root maps being recommended as uncovered knowledge.
**Architecture:** Reuse knowledgePaths and mocPathSet; separate coverage totals
without duplicating the full knowledge set or changing graph usage semantics.
**Tech Stack:** TypeScript, Vitest, temporary Markdown, in-memory MCP.

- [x] Create src/moc-coverage-population.test.ts using real services/notes.
  Typed root map plus one linked atomic note must yield
  `{knowledgeTotal:1,knowledgeLinkedFromMoc:1,ratio:1}` while knowledgeUsage.total
  stays2. Matrix includes unset managed type, case/space-normalized map kinds.
- [x] Run `npm test -- src/moc-coverage-population.test.ts --maxWorkers=1` and
  verify RED comes from wrong coverage population/discovery, not fixture errors.
- [x] In graphHealth normalize scalar-text kind with trim/lowercase (non-text
  stays unknown); use kind==='moc' for
  map discovery. Beside mocPathSet define:
  ```ts
  const isCoverageKnowledge = (path: string) => knowledgePaths.has(path) && !mocPathSet.has(path);
  let coverageKnowledgeTotal = knowledgePaths.size;
  for (const path of mocPathSet) if (knowledgePaths.has(path)) coverageKnowledgeTotal -= 1;
  ```
  Use predicate for linked/direct/indirect and uncovered filters; use total for
  coverage ratios/counts only. Keep all other knowledgePaths consumers intact.
- [x] Add nested/cyclic and maps-only inventory tests, genuine uncovered-note
  candidate assertions, private/hidden/snapshot filters and MCP budgets.
  Assert source bytes unchanged and full usage totals preserved.
- [x] Document coverage population in README.md, _wiki/SCHEMA.md and dynamic
  graph/candidate descriptions in src/llm-wiki-tools.ts. No new endpoint.
- [x] Focused tests, npm run build, independent review, full
  `npm test -- --maxWorkers=1`, `git -c core.safecrlf=false diff --check`.
- [ ] Commit explicit files plus generated dist; push origin main and verify.

## Evidence

- Initial RED12 failures/2 passes: managed-map denominators and normalized-map
  discovery. GREEN14. Added array-kind boundary: RED2; scalar type check fixes
  accidental coercion. Final new tests16.
- Focused three-file regression61 passed in8.09s. Build and diff check pass.
- Real MCP budgets512/6000/16000 checked; five tools retained. Temporary source
  bytes unchanged; no live Vault writes, extra model or service.
- Independent scoped review found no actionable introduced defects; reviewer
  closed. Full single-worker suite: 2,682 passed / 1 skipped across174 files,
  336.12s, exit0.
