# Exact and fail-closed derived cache budgeting

User has delegated design and fork-main integration. Direct reproduction against
47ccdde: registering NaN or Infinity poisons totalBytes to NaN, so later 8+8
registrations survive a 10-byte limit. A MAX_SAFE_INTEGER oversized entry replaced
by a 2-byte entry leaves totalBytes=1 rather than2. No production occurrence is
asserted; these are demonstrated core-budget failure paths.

## Policy

Accept finite nonnegative number charges whose ceiling is a safe integer.
Zero remains supported; positive fractions round up as before. Non-number,
negative, nonfinite or unsafe charges are uncacheable: remove any previous
registration for that owner/key, call the new value's eviction callback exactly
once and return without adding budget state. Swallow callback errors like normal
eviction; a faulty disposable estimate must not break authoritative operations.
Do not clamp invalid values to zero or Infinity. Caller stores the new cache value
before register, so merely throwing would leave that value untracked.

Max budget must be finite, positive and at most MAX_SAFE_INTEGER. Fractional max
values remain allowed. Configuration failures throw before any registration.
Use BigInt only for internal total accumulation/subtraction and comparison with
floor(maxBytes). Entry charges and public snapshot shape remain numbers. After
completed operations, total is within max or one explicitly allowed oversized
safe-integer entry, so public totals are exactly representable. Internal exact
arithmetic also survives nested bounded callbacks while temporarily over budget.
As before, callbacks can observe intermediate eviction state; no transactional
snapshot promise during callback execution is introduced.

Alternatives: validation alone does not fix valid safe-integer addition overflow;
capping all charges/budgets at a smaller limit constrains legitimate values and
still complicates reentrant eviction. Exact internal accumulation is simplest;
measure its local bookkeeping cost rather than assuming it is free.

## Verification

Invalid initial/replacement charges, throwing and reentrant disposal, ordinary
fraction/zero charges, constructor bounds, large safe integer add/remove/replace
and oversized exemption. Deterministic model-based sequence compares public
snapshots and eviction order against an independent Map-LRU with exact totals.
No large memory allocation is required: large charges are numeric metadata only.
Existing shared-budget clients and full one-worker regression must pass. No new
client config/service, live server restart or upstream contribution.
