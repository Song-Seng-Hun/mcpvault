# Catalog Byte Accounting Implementation Plan

> Execute inline with executing-plans, TDD and independent review. Design and
> fork-main integration are already approved.

**Goal:** Remove catalog-sized JSON allocation and repeated subtree byte scans.
**Architecture:** Pure string byte counter; counts accumulated in normalization,
classification and tree merges; cached counts travel with their arrays.
**Tech Stack:** TypeScript, Vitest, real temporary filesystem, existing budget.

- [ ] Add src/catalog-byte-accounting.test.ts using real nested Unicode notes.
  Spy JSON.stringify only for values with mtimeMs/entries; expect zero catalog
  serialization across cold/warm/parent invalidation. Assert public paths, then
  independently compare each cache's charged fields with native serialized
  legacy payload+64. Add warm-child count reuse and real budget eviction/close
  tests. Observe RED before implementation.
- [ ] Add src/json-string-bytes.test.ts and src/json-string-bytes.ts. Implement
  jsonStringBytes(value): start2 quotes; ASCII quote/backslash2, short control2,
  other control6, other ASCII1, below0x8002, valid surrogate pair4 advancing twice,
  unpaired surrogate6, other code unit3. Validate against native JSON byte lengths
  including all code units and mixed deterministic strings.
- [ ] Modify src/vault-catalog.ts: DirectoryCacheEntry entryBytes required;
  noteBytes/allBytes optional but required for a subtree cache hit. Inventory
  return includes both counts, missing-child zero. normalizeDirectoryEntries
  returns {entries,entryBytes}; add jsonStringBytes(name)+48 while already
  iterating. Classify each allowed file: bytes=jsonStringBytes(path)+1, add to
  allBytes and optionally noteBytes. Merge child counters after awaited array
  merges. Store matching counters with arrays. Register with
  256+cached.entryBytes+(cached.noteBytes??0)+(cached.allBytes??0), or
  256+entryBytes for initial entries. Remove only catalog estimateCacheBytes use.
- [ ] Run focused new/cooperative/normalization/close/reconciliation/traversal/
  budget tests with maxWorkers1, npm run build, README caveats and independent
  lifecycle/accounting review. Fix findings with regression coverage.
- [ ] Run full npm test -- --maxWorkers=1; git -c core.safecrlf=false diff --check.
  Record exact results, commit explicit files including generated dist; push
  origin main only, verify HEAD agreement and preserve unrelated files.
