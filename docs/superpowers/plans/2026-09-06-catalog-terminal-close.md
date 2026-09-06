# Catalog Terminal Close Implementation Plan

> For agentic workers: executing-plans inline, independent lifecycle review;
> design and main/fork integration are user-approved.

**Goal:** Prevent closed inventories from restarting IO or repopulating caches.

**Architecture:** A terminal closed guard around public reads and asynchronous
publication; no-op late events/subscriptions; retain current refresh ownership.

**Tech Stack:** TypeScript, temporary filesystem, deferred promises, Vitest.

- [ ] Add `src/catalog-close.test.ts` with delayed actual readdir/stat boundaries,
  owned temp cleanup, and public reads. Test close-before-read, close-during-read
  with/without watching, delayed stats, late subscriptions/events/invalidation,
  and failed barrier completion. Observe RED before changing source.
- [ ] Update `src/vault-catalog.ts`: assertOpen on reads and immediately after
  awaited IO before publication; close is idempotent and advances generation,
  does not drop refreshPromise prematurely; no-op post-close mutation/event
  methods, no watcher restart, and no late flush retry flag after close.
- [ ] Run new plus existing catalog/reconciliation/read-barrier tests, build,
  independent lifecycle review and full `npm test -- --maxWorkers=1`. README
  documents closed error/no-op notifications and native IO cancellation limits.
- [ ] Verify `git -c core.safecrlf=false diff --check`, stage explicit
  source/tests/docs/dist and commit/push only origin main after verification.
