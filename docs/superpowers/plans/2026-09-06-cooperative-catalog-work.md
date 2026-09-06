# Cooperative Catalog Work Implementation Plan

> For agentic workers: use executing-plans inline and independent lifecycle
> review. Design/main integration are already user-approved.

**Goal:** Let pending IO/termination run during large catalog filtering/merges.

**Architecture:** Internal forEachInventoryItem over readonly arrays, fixed256
items, real setImmediate between batches and owner liveness checks.

**Tech Stack:** TypeScript, node:timers/promises, real temporary Markdown, Vitest.

- [x] Add `src/catalog-cooperative.test.ts`:600 real tiny notes, observed listing
  calls, schedule setImmediate from first call. Assert marker observes256 calls,
  close aborts at256, and delivered mid-walk mutation is included after retry.
  Run targeted test and observe RED before implementation.
- [x] Add `src/inventory-work.ts`: async forEachInventoryItem<T>(readonly T[],
  synchronous visit, assertOpen), loop offsets256 without slice, awaitsetImmediate
  only between batches and check guard. Add direct helper tests for order/error/
  liveness/empty/small input. Replace catalog entry loop and notes/all merging;
  guard after awaited work before child dispatch and cache publication.
- [x] Run helper/cooperative/close/reconciliation/large-inventory tests one-worker,
  build and independent lifecycle review. README documents item—not-time—bounds,
  unchanged current-source/generation behavior, remaining synchronous phases.
- [x] Run full `npm test -- --maxWorkers=1` and whitespace check.
- [ ] Commit explicit source/tests/docs/dist and push only origin main after
  verification; confirm remote main and local HEAD agree.

## Verification evidence

- Before implementation, all three integration tests failed: a pending immediate
  observed all 600 listing checks rather than 256, close did not reject the
  in-flight list, and an invalidation delivered during the checkpoint was absent
  from the returned inventory (600 rather than 601).
- After implementation: 44 tests across five focused files passed, and
  `npm run build` passed.
- Independent read-only lifecycle/generation review found no blocking issues.
  Its nonblocking cached-child coverage gap was addressed by a fourth integration
  test: 1,200 real notes, frozen cached child arrays, parent-only invalidation,
  and closure scheduled on child cache access. All four integration tests passed.
- Final full single-worker suite: 2,423 passed, one skipped, 161 files, 285.61s;
  process exited successfully. Whitespace check passed. No wall-clock latency,
  whole-process memory reduction, or diagnosis of the earlier desktop stutter
  is claimed. Integration remains pending until Git verifies the fork push.
