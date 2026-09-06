# Catalog Terminal Close Implementation Plan

> For agentic workers: executing-plans inline, independent lifecycle review;
> design and main/fork integration are user-approved.

**Goal:** Prevent closed inventories from restarting IO or repopulating caches.

**Architecture:** A terminal closed guard around public reads and asynchronous
publication; no-op late events/subscriptions; retain current refresh ownership.

**Tech Stack:** TypeScript, temporary filesystem, deferred promises, Vitest.

- [x] Add `src/catalog-close.test.ts` with delayed actual readdir/stat boundaries,
  owned temp cleanup, and public reads. Test close-before-read, close-during-read
  with/without watching, delayed stats, late subscriptions/events/invalidation,
  and failed barrier completion. Observe RED before changing source.
- [x] Update `src/vault-catalog.ts`: assertOpen on reads and immediately after
  awaited IO before publication; close is idempotent and advances generation,
  does not drop refreshPromise prematurely; no-op post-close mutation/event
  methods, no watcher restart, and no late flush retry flag after close.
- [x] Run new plus existing catalog/reconciliation/read-barrier tests, build,
  independent lifecycle review and full `npm test -- --maxWorkers=1`. README
  documents closed error/no-op notifications and native IO cancellation limits.
- [x] Verify `git -c core.safecrlf=false diff --check`.

Integration follows verification: stage explicit source/tests/docs/dist and
commit/push only origin main; verify remote tracking state in the handoff.

## Evidence

- RED: all six initial lifecycle tests failed on previous code: post-close reads
  resolved, delayed directory/stat results published, late subscriptions retained
  listeners and failed barriers requeued refresh state.
- GREEN: six lifecycle tests plus existing catalog suites passed 38 tests.
- Four additional public-return boundaries observed RED after a real inner
  inventory completed then close ran; post-await wrapper guards made all42
  targeted tests pass across four files. Build and whitespace validation passed.
- Full one-worker suite and independent lifecycle review are in progress. No
  live Vault/server changes or cooperative-yield claims are part of this batch.
- Review found a P2 callback boundary: a subscriber closing after the first
  32-item notification batch still allowed the next native stat batch to start.
  Two real 40-file tests (batch and legacy listeners) observed RED40 vs32 stats;
  a closed guard at the top of each batch fixed it. Focused suites now pass44
  tests; build passed. Full verification must be repeated after this delta.
- Intermediate full run, started before the callback fix, retained the old loaded
  source and failed exactly the two newly added callback tests (2,413 passed,
  one skipped). A fresh full run after the fix is required, not treating that
  mixed execution as final evidence. Independent delta review approved; reviewer
  closed.
- Fresh final full suite: 2,415 passed, one skipped, 159 files, 278.87 seconds.
  Build and whitespace checks passed. No live server/Vault changes performed.
