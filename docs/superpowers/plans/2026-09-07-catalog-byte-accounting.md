# Catalog Byte Accounting Implementation Plan

> Execute inline with executing-plans, TDD and independent review. Design and
> fork-main integration are already approved.

**Goal:** Remove catalog-sized JSON allocation and repeated subtree byte scans.
**Architecture:** Pure string byte counter; counts accumulated in normalization,
classification and tree merges; cached counts travel with their arrays.
**Tech Stack:** TypeScript, Vitest, real temporary filesystem, existing budget.

- [x] Add src/catalog-byte-accounting.test.ts using real nested Unicode notes.
  Spy JSON.stringify only for values with mtimeMs/entries; expect zero catalog
  serialization across cold/warm/parent invalidation. Assert public paths, then
  independently compare each cache's charged fields with native serialized
  legacy payload+64. Add warm-child count reuse and real budget eviction/close
  tests. Observe RED before implementation.
- [x] Add src/json-string-bytes.test.ts and src/json-string-bytes.ts. Implement
  jsonStringBytes(value): start2 quotes; ASCII quote/backslash2, short control2,
  other control6, other ASCII1, below0x8002, valid surrogate pair4 advancing twice,
  unpaired surrogate6, other code unit3. Validate against native JSON byte lengths
  including all code units and mixed deterministic strings.
- [x] Modify src/vault-catalog.ts: DirectoryCacheEntry entryBytes required;
  noteBytes/allBytes optional but required for a subtree cache hit. Inventory
  return includes both counts, missing-child zero. normalizeDirectoryEntries
  returns {entries,entryBytes}; add jsonStringBytes(name)+48 while already
  iterating. Classify each allowed file: bytes=jsonStringBytes(path)+1, add to
  allBytes and optionally noteBytes. Merge child counters after awaited array
  merges. Store matching counters with arrays. Register with
  256+cached.entryBytes+(cached.noteBytes??0)+(cached.allBytes??0), or
  256+entryBytes for initial entries. Remove only catalog estimateCacheBytes use.
- [x] Run focused new/cooperative/normalization/close/reconciliation/traversal/
  budget tests with maxWorkers1, npm run build, README caveats and independent
  lifecycle/accounting review. Fix findings with regression coverage.
- [x] Run full npm test -- --maxWorkers=1; git -c core.safecrlf=false diff --check.
  Record exact results.
- [x] Commit explicit files including generated dist; push
  origin main only, verify HEAD agreement and preserve unrelated files.

## Evidence

- Initial integration RED: six whole-cache JSON serializations instead of zero;
  missing numeric counters. Existing real-budget eviction test passed already.
- Pure counter's initial missing module was not accepted as behavioral evidence;
  a zero-result stub then failed all 12 tests before the real counter was written.
  Coverage compares all 65,536 isolated UTF-16 units plus mixed/control/surrogate
  strings to native JSON UTF-8 lengths, with bounded individual mismatch output.
- 72 focused tests across eight files passed; npm run build passed.
- Three added tests prove cached-child byte-count reuse, deletion counter updates
  and zero-count empty-child reuse. Final integration file: six tests passed.
- Independent read-only Astra review found no actionable defects. Disappearing
  child and artificially missing-counter cache fixtures were suggested as optional
  coverage, not observed production defects. Reviewer closed after completion.
- Full one-worker regression passed: 2,453 passed, one skipped, 164 files,
  304.73s, successful process exit. Build and whitespace checks passed. No
  measured RSS/CPU improvement or live server activation is claimed; fixed
  margins may trigger somewhat earlier eviction.
- Implementation `73ac35c` pushed to user fork `Song-Seng-Hun/mcpvault` main.
  Local HEAD and origin/main matched afterward; unrelated `.agents/` and
  `.mcpvault/` remained untracked. No upstream contribution or live restart.
