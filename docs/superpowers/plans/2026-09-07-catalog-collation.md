# Catalog Collation Implementation Plan

> Execute inline with TDD and independent review. User approved design and
> commits/pushes to fork main; no upstream contribution.

**Goal:** Reduce repeated locale-aware comparator dispatch while preserving order.
**Architecture:** One default bound collator per valid nontrivial refresh;
native sort and existing generation/close checks remain authoritative.
**Tech Stack:** TypeScript, Intl.Collator, real temporary Markdown, Vitest.

- [ ] Add src/catalog-collation.test.ts. Real mixed-language files under
  temporary root. Capture default Intl.Collator constructor and string comparison
  calls during listAllPaths, compare result to precomputed native ordering.
  Expect one default constructor and zero string method calls; warm read adds
  none, explicit invalidation adds one. Verify empty/singleton no constructor,
  watched/unwatched modes, and missing Collator fallback. Observe RED.
- [ ] In src/vault-catalog.ts refresh, after current generation guard:
  ```ts
  if (inventory.notes.length > 1 || inventory.all.length > 1) {
    const compare = typeof Intl === 'object' && typeof Intl.Collator === 'function'
      ? new Intl.Collator().compare : (a: string, b: string) => a.localeCompare(b);
    inventory.notes.sort(compare);
    inventory.all.sort(compare);
  }
  ```
  No new async boundary or service. Document scope/locale/synchronous-sort caveats.
- [ ] Run targeted collation/normalization/cooperative/close/reconciliation/
  traversal/accounting tests with maxWorkers1, npm run build, independent review.
  Add stale-census no-constructor assertion to existing real mutation test.
- [ ] Run final full npm test -- --maxWorkers=1 and whitespace check; record
  exact evidence. Commit explicit source/tests/docs/dist; push only origin main
  and verify tracking/local HEAD match. Preserve unrelated .agents/.mcpvault.
