# Catalog Normalization Implementation Plan

> For agentic workers: execute inline using executing-plans and TDD; obtain an
> independent lifecycle review. Design and main integration are user-approved.

**Goal:** Yield during Dirent normalization; skip cache publication and sorting
for known-obsolete censuses while preserving stable output.

**Architecture:** Existing 256-item helper, private conversion helper, generation
guards before cache publication and native sorting. No new public API.

**Tech Stack:** TypeScript, real filesystem Dirents, Vitest, node setImmediate.

- [ ] Add src/catalog-normalization.test.ts. Wrap actual readdir, instrument
  actual isDirectory on the first root census; schedule an immediate at call1.
  Watched/unwatched: assert observed256, close rejection with256calls and empty
  caches, mutation Late.md included in601 final paths. Observe entry cache after
  stale normalization: absent and root dirty in watched mode. Wrap real findPaths
  root results to observe actual sort methods: obsolete first [0,0], stable
  second [1,1]. Run `npm test -- src/catalog-normalization.test.ts --maxWorkers=1`
  and observe missing-behavior failures before editing source.
- [ ] In src/vault-catalog.ts import Dirent type. Add private helper:
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
- [ ] Run new tests plus cooperative/close/reconciliation/traversal tests with
  maxWorkers1. Update README normalization/obsolete-work claims and synchronous
  sort caveat. Run npm run build. Request read-only lifecycle/generation review.
- [ ] Run full npm test -- --maxWorkers=1 after any review fixes, and
  git -c core.safecrlf=false diff --check. Record exact results, commit explicit
  source/tests/docs/dist, push only origin main, and verify remote tracking HEAD.
