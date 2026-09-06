# Directory Traversal Budget Implementation Plan

> For agentic workers: use executing-plans inline and independent review; design
> and main/fork integration are user-approved.

**Goal:** Bound recursive directory IO across the full tree and safely merge large
inventories while retaining cache, filter and failure semantics.

**Architecture:** Pass a positive integer budget down the existing two walkers;
partition among siblings rather than multiplying concurrency at each level.

**Tech Stack:** TypeScript, Promise.allSettled, Vitest virtual readdir boundary.

- [ ] Create `src/directory-traversal-budget.test.ts`: exercise catalog public
  listNotePaths with watching disabled and semantic scan/fallback; fake only the
  directory listing, use owned temp roots for other IO. Count unfinished reads in
  an 8x8 tree, exercise a 150,000-file child, and hold a sibling during fallback
  enumeration error. Run `npm test -- src/directory-traversal-budget.test.ts
  --maxWorkers=1`; expect RED concurrency >8, spread overflow, early rejection.
- [ ] Modify private findPaths in `src/vault-catalog.ts` and findMarkdownFiles in
  `src/semantic-search.ts` to accept budget default8. Child batching uses budget;
  pass `Math.floor(budget / batch.length) + (index < budget % batch.length ? 1 : 0)`
  recursively. Replace result spreads with per-path push. For fallback use
  Promise.allSettled and throw the first rejected reason only after all settle.
- [ ] Run new tests and existing catalog/reconciliation/read-barrier/semantic
  integrity tests with one worker. Update README with per-tree cap and static
  partition tradeoff; run build and full `npm test -- --maxWorkers=1`.
- [ ] Independently review source, coverage and cache/order semantics. Run
  `git -c core.safecrlf=false diff --check`, commit explicit source/tests/docs/dist
  and push only origin main. Record observed evidence, not inferred RAM savings.
