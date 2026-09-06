# Cooperative Catalog Work Implementation Plan

> For agentic workers: use executing-plans inline and independent lifecycle
> review. Design/main integration are already user-approved.

**Goal:** Let pending IO/termination run during large catalog filtering/merges.

**Architecture:** Internal forEachInventoryItem over readonly arrays, fixed256
items, real setImmediate between batches and owner liveness checks.

**Tech Stack:** TypeScript, node:timers/promises, real temporary Markdown, Vitest.

- [ ] Add `src/catalog-cooperative.test.ts`:600 real tiny notes, observed listing
  calls, schedule setImmediate from first call. Assert marker observes256 calls,
  close aborts at256, and delivered mid-walk mutation is included after retry.
  Run targeted test and observe RED before implementation.
- [ ] Add `src/inventory-work.ts`: async forEachInventoryItem<T>(readonly T[],
  synchronous visit, assertOpen), loop offsets256 without slice, awaitsetImmediate
  only between batches and check guard. Add direct helper tests for order/error/
  liveness/empty/small input. Replace catalog entry loop and notes/all merging;
  guard after awaited work before child dispatch and cache publication.
- [ ] Run helper/cooperative/close/reconciliation/large-inventory tests one-worker,
  build and independent lifecycle review. README documents item—not-time—bounds,
  unchanged current-source/generation behavior, remaining synchronous phases.
- [ ] Run full `npm test -- --maxWorkers=1` and whitespace check, then commit
  explicit source/tests/docs/dist and push only origin main after verification.
