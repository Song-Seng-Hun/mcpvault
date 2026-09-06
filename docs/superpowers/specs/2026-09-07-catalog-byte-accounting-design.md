# Incremental directory cache byte accounting

Design/main integration is user-approved. Existing catalog registration calls
estimateCacheBytes twice per directory, serializing entries and whole subtrees.
Remove those full JSON temporary strings without changing other cache owners.

## Representation and invariants

- Add a pure JSON-string UTF-8 byte counter, no JSON/string/Buffer allocation.
  Include quotes, escapes, paired/unpaired surrogates and control characters.
- Normalize directory entries with an accumulated `entryBytes` count. Each
  compact record charges its quoted name bytes plus 48 bytes (fields, booleans,
  commas and margin). The helper returns entries/count together, not a global
  side table. readDirectoryEntries still returns its existing entry array.
- Inventory adds `noteBytes` and `allBytes`. Charge quoted path bytes plus one
  comma when first classified; note paths share the calculation, but both
  arrays are charged. Add child counters when merging; do not rescan strings.
  Cached subtree reuse returns arrays and matching counts. Missing child is
  empty with zero counts. Count fields must be present before a cache hit.
- Registration charges 256 bytes fixed envelope plus entry/note/all counters.
  This is a conservative serialized-size proxy, not a measured V8 heap bound.
  Tests must show it never falls below the former serialized payload+64 for
  representative data. Numeric bookkeeping is covered by the fixed margin.
- Preserve cooperative 256-item loops, closure/generation guards, cache eviction
  identity checks, bounded reconciliation, path filtering and output ordering.

Alternatives: a generic JSON replacement would change unrelated cache semantics;
rescanning every value without serializing would retain avoidable repeated work.
This scoped incremental approach has small numeric state and no client changes.

## Verification

Real temporary nested Unicode files; instrument only JSON.stringify to count
catalog serialization, and the pure counter for repeated-work evidence. Compare
all live cache counts to independent full payload serialization in tests. Warm
child reuse after parent invalidation must not recount child names/paths. Actual
shared-budget pressure must evict derived caches without changing public results;
close must clear owner accounting. Verify ASCII, CJK, emoji, every control code,
quotes/slashes, lone surrogates against the native serializer. Full build and
single-worker suite, independent lifecycle/accounting review, fork-only push.
