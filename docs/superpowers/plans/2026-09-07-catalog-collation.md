# Catalog Collation Implementation Plan

> Execute inline with TDD and independent review. User approved design and
> commits/pushes to fork main; no upstream contribution.

**Goal:** Reduce repeated locale-aware comparator dispatch while preserving order.
**Architecture:** One default bound collator per valid nontrivial refresh;
native sort and existing generation/close checks remain authoritative.
**Tech Stack:** TypeScript, Intl.Collator, real temporary Markdown, Vitest.

- [x] Add src/catalog-collation.test.ts. Real mixed-language files under
  temporary root. Capture default Intl.Collator constructor and string comparison
  calls during listAllPaths, compare result to precomputed native ordering.
  Expect one default constructor and zero string method calls; warm read adds
  none, explicit invalidation adds one. Verify empty/singleton no constructor,
  watched/unwatched modes, and missing Collator fallback. Observe RED.
- [x] In src/vault-catalog.ts refresh, after current generation guard:
  ```ts
  if (inventory.notes.length > 1 || inventory.all.length > 1) {
    const compare = typeof Intl === 'object' && typeof Intl.Collator === 'function'
      ? new Intl.Collator().compare : (a: string, b: string) => a.localeCompare(b);
    if (inventory.notes.length > 1) inventory.notes.sort(compare);
    if (inventory.all.length > 1) inventory.all.sort(compare);
  }
  ```
  No new async boundary or service. Document scope/locale/synchronous-sort caveats.
- [x] Run targeted collation/normalization/cooperative/close/reconciliation/
  traversal/accounting tests with maxWorkers1, npm run build, independent review.
  Add stale-census no-constructor assertion to existing real mutation test.
- [x] Run final full npm test -- --maxWorkers=1 and whitespace check; record
  exact evidence.
- [ ] Commit explicit source/tests/docs/dist; push only origin main
  and verify tracking/local HEAD match. Preserve unrelated .agents/.mcpvault.

## Evidence

- Initial RED: watched/unwatched reads dispatched localeCompare 36 times rather
  than zero. Four compatibility edge tests already passed before implementation.
- First focused run exposed a constructor-spy artifact: plain spying did not
  forward native construction, yielding undefined compare and lexical ordering.
  Fixed instrumentation to return an actual native Collator, with no production
  workaround. Added uninstrumented real-Unicode-file ordering coverage.
- Reviewer found trivial notes arrays still received sort calls when multiple
  attachments existed. Two real-file tests reproduced one call instead of zero;
  arrays now independently check length. Delta review approved, worker closed.
- Final focused run: 68 tests across seven files passed. npm run build and
  whitespace check passed. Final full single-worker regression passed:
  2,462 passed, one skipped, 165 files, 313.21s, successful process exit.
- Local alternating microbenchmark and accounting experiment are documented in
  the spec with input generation, environment, measurement boundaries and caveats.
