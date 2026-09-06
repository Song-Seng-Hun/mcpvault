# Catalog Normalization Implementation Plan

> For agentic workers: execute inline using executing-plans and TDD; obtain an
> independent lifecycle review. Design and main integration are user-approved.

**Goal:** Yield during Dirent normalization; skip cache publication and sorting
for known-obsolete censuses while preserving stable output.

**Architecture:** Existing 256-item helper, private conversion helper, generation
guards before cache publication and native sorting. No new public API.

**Tech Stack:** TypeScript, real filesystem Dirents, Vitest, node setImmediate.

- [x] Add src/catalog-normalization.test.ts. Wrap actual readdir, instrument
  actual isDirectory on the first root census; schedule an immediate at call1.
  Watched/unwatched: assert observed256, close rejection with256calls and empty
  caches, mutation Late.md included in601 final paths. Observe entry cache after
  stale normalization: absent and root dirty in watched mode. Wrap real findPaths
  root results to observe actual sort methods: obsolete first [0,0], stable
  second [1,1]. Run `npm test -- src/catalog-normalization.test.ts --maxWorkers=1`
  and observe missing-behavior failures before editing source.
- [x] In src/vault-catalog.ts import Dirent type. Add private helper:
  ```ts
  private async normalizeDirectoryEntries(listed: readonly Dirent[]): Promise<DirectoryCacheEntry['entries']> {
    const entries: DirectoryCacheEntry['entries'] = [];
    await forEachInventoryItem(listed, entry => {
      entries.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() });
    }, () => this.assertOpen());
    this.assertOpen();
    return entries;
  }
  ```
  Replace both map calls with awaited helper, guard again after awaits. Snapshot
  generation at readDirectoryEntries start; before dirty-marker deletion and
  cache writes return entries if drifted. In refresh after assertOpen add
  `if (generation !== this.changeGeneration) return;` before sorts. Preserve
  existing IO error translation and root/child missing semantics.
- [x] Run new tests plus cooperative/close/reconciliation/traversal tests with
  maxWorkers1. Update README normalization/obsolete-work claims and synchronous
  sort caveat. Run npm run build. Request read-only lifecycle/generation review.
- [x] Run full npm test -- --maxWorkers=1 after any review fixes, and
  git -c core.safecrlf=false diff --check. Record exact results.
- [x] Commit explicit source/tests/docs/dist, push only origin main, and verify
  remote tracking HEAD.

## Evidence

- Initial seven tests failed for the intended missing behavior: conversion
  observed 600 rather than 256 calls; close happened after all 600 conversions;
  obsolete inventories still sorted both arrays; stale entry-cache state was
  not retained as dirty during conversion (the callback ran later).
- Implementation passed 48 focused tests across five files and npm run build.
- Independent read-only Astra lifecycle/generation review: no blocking findings.
  Added coverage for empty/one-file conversion completion close boundaries and
  populated-cache invalidation with a reentrant public reader. Both readers
  receive the same current 601-note result with only two new root reads; old
  frozen entry records remain untouched. Final new-test file: 12 passed.
- Full one-worker regression passed: 2,435 passed, one skipped, 162 files,
  306.78s, successful process exit. Build and whitespace checks passed. No
  production activation or whole-PC performance claim is made. Review worker
  was closed after completing review.
- Implementation `bd66add` pushed successfully to user fork
  `Song-Seng-Hun/mcpvault` main. HEAD and origin/main matched afterward; only
  unrelated `.agents/` and `.mcpvault/` remained untracked. No upstream action.

## Next measured opportunity (not implemented here)

`src/cache-budget.ts` estimateCacheBytes serializes its entire value with
JSON.stringify before Buffer.byteLength. Catalog cache registration still uses
this synchronous whole-string allocation. Assess incremental/specialized size
accounting without weakening budget enforcement in a separate tested change;
neither that temporary allocation nor valid-census native sorting is removed
by this normalization batch.
