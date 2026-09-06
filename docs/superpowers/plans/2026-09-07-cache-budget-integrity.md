# Cache Budget Integrity Implementation Plan

> Use inline TDD and independent integrity review. Design/main integration is
> user-approved; run tests one-worker and preserve unrelated local files.

**Goal:** Prevent invalid charges and precision loss from disabling cache limits.
**Architecture:** Fail-closed invalid registrations; exact internal integer total,
unchanged number-shaped public API and heap/owner/LRU structures.
**Tech Stack:** TypeScript BigInt, Vitest, independent deterministic model.

- [ ] Add src/cache-budget-integrity.test.ts: invalid charge table, replacement
  cleanup without evicting another owner, throwing/reentrant disposal, constructor
  invalid limits, safe large integer replacement exact2 ratherthan1, allowed
  fractions/zero and oversized behavior. Observe RED with production budget.
- [ ] In src/cache-budget.ts make totalBytes=0n and private maxAccountedBytes.
  Constructor: reject maxBytes>MAX_SAFE_INTEGER as well as old invalid cases;
  set maxAccountedBytes=BigInt(Math.floor(maxBytes)). register after removing old
  id: boundedBytes=Number.isFinite(bytes)&&bytes>=0?Math.ceil(bytes):NaN;
  if !Number.isSafeInteger(boundedBytes), invoke new onEvict under try/catch and
  return. Otherwise existing admission plus totalBytes+=BigInt(boundedBytes).
  Removal subtracts BigInt(entry.bytes), enforcement compares maxAccountedBytes,
  snapshot returns Number(totalBytes). Keep all normal LRU/callback semantics.
- [ ] Add independent Map-LRU model sequence with exact totals, touch/remove/
  clearOwner/re-register/eviction and safe oversized cases. Compare snapshots and
  callback order after every operation. Run focused integrity/budget/catalog/
  semantic/search tests maxWorkers1, build, independent review, README policy.
- [ ] Run full npm test -- --maxWorkers=1; whitespace check. Record findings,
  results and a bounded bookkeeping experiment. Commit explicit source/tests/
  docs/dist; push only origin main and verify matching tracking/local HEAD.
