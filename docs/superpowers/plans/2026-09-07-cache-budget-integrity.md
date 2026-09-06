# Cache Budget Integrity Implementation Plan

> Use inline TDD and independent integrity review. Design/main integration is
> user-approved; run tests one-worker and preserve unrelated local files.

**Goal:** Prevent invalid charges and precision loss from disabling cache limits.
**Architecture:** Fail-closed invalid registrations; exact internal integer total,
unchanged number-shaped public API and heap/owner/LRU structures.
**Tech Stack:** TypeScript BigInt, Vitest, independent deterministic model.

- [x] Add src/cache-budget-integrity.test.ts: invalid charge table, replacement
  cleanup without evicting another owner, throwing/reentrant disposal, constructor
  invalid limits, safe large integer replacement exact2 ratherthan1, allowed
  fractions/zero and oversized behavior. Observe RED with production budget.
- [x] In src/cache-budget.ts make totalBytes=0n and private maxAccountedBytes.
  Constructor: reject maxBytes>MAX_SAFE_INTEGER as well as old invalid cases;
  set maxAccountedBytes=BigInt(Math.floor(maxBytes)). register after removing old
  id: boundedBytes=Number.isFinite(bytes)&&bytes>=0?Math.ceil(bytes):NaN;
  if !Number.isSafeInteger(boundedBytes), invoke new onEvict under try/catch and
  return. Otherwise existing admission plus totalBytes+=BigInt(boundedBytes).
  Removal subtracts BigInt(entry.bytes), enforcement compares maxAccountedBytes,
  snapshot returns Number(totalBytes). Keep all normal LRU/callback semantics.
- [x] Add independent Map-LRU model sequence with exact totals, touch/remove/
  clearOwner/re-register/eviction and safe oversized cases. Compare snapshots and
  callback order after every operation. Run focused integrity/budget/catalog/
  semantic/search tests maxWorkers1, build, independent review, README policy.
- [x] Run full npm test -- --maxWorkers=1; whitespace check. Record findings,
  results and a bounded bookkeeping experiment.
- [ ] Commit explicit source/tests/
  docs/dist; push only origin main and verify matching tracking/local HEAD.

## Evidence

- Direct baseline reproduction: NaN/Infinity poison the ledger; MAX_SAFE_INTEGER
  oversized replacement followed by a2-byte item reported1.
- RED: initial17tests had10failures; expanded20tests had12failures, including the
  extreme-value Map-LRU oracle. Normal-only oracle already passed.
- After implementation76focusedtests across4files passed; build passed.
- Independent Astra integrity review found no actionable defects and confirmed
  store-before-register use across14production registration sites. Added its
  optional same-key reentrant disposal and callback numeric JSON snapshot cases,
  plus real Map-backed caller-result preservation/noncoercion checks. Final
  integrity file24tests passed; reviewer closed. Final full one-worker suite:
  2,486 passed, one skipped, 166 files, 308.41s, successful exit. Build and
  whitespace checks passed.
- Local bookkeeping comparison: Node22.23.2, 10kregisters/sample, 3warmup and
  7measured rounds alternating baseline/current. Budget32768, owner=o(n%4),
  key=k(n%128), charge=n%1000+32; touch every3rd operation, remove key(n+3)%128
  every7th, clear all4owners afterward and verify empty ledger. Median baseline
  6.9573ms, exact7.7101ms. Metadata only, no cache payload or traffic allocation;
  this correctness fix has measured local overhead, not a speedup claim. Baseline
  loaded from HEAD:dist/src/cache-budget.js before implementation was committed.

## Follow-up audit

The remaining generic estimateCacheBytes still returns zero on serialization
failure. All current production usages feed budget registrations (sometimes via
addition/multiplication). Distinguish failed estimation from a legitimate zero
charge in a separate tested change; this batch protects the ledger from invalid
numeric inputs but does not certify every caller's estimator or real heap size.
