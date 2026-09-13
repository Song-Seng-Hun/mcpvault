# Bounded overflow backlink reuse (2026-09-13)

Cross-model review identified a real remaining cost: once a caller-view's full
reverse index exceeds 16,384 resolved occurrences, each target query resolves
all visible authored links again. The limit counts occurrences, not documents.
The earlier alias/directory-body-read issue is separate and remains fixed.

## Contract and trade-offs

`src/graph/backlink-occurrence-cache.ts` is a focused internal read-model module.
Sparse views retain the existing full index. Overflow views retain up to 64
complete target lists / 12,288 occurrence references in LRU order. One active
fill holds at most 4,096 references. Oversized targets stream uncached; concurrent
misses stream without a second fill. Empty targets count toward the key limit.
Abandoned, budget-truncated or failed scans cannot admit a prefix as complete.
Exact duplicate occurrences, relation/anchor/provenance fields and order survive.

The cache belongs to the existing predicate/membership/generation context. No
cache is shared across different predicate identities; a new predicate per call
does not obtain cross-call reuse. ACL closure membership is still checked on each
read. Source freshness checks, projections, counters, response budgets, filters,
source revisions and end-of-read invalidation remain downstream of cache hits.
Raw candidate occurrences are not evidence validation or permission decisions.

These are logical reference/key limits, not a byte-accurate process memory cap.
In-flight response iterators and old contexts can retain references separately.
No persistent index, schema, MCP endpoint, authority or source write is added.
It does not eliminate O(N) visibility checks/metadata census, improve every cold
target, or cache a target exceeding 4,096 incoming occurrences. A large hub still
uses the correctness-preserving scan fallback. Do not extrapolate to O(1) queries.

## Reproducible measurement

Run `node scripts/benchmark-backlink-cache.mjs --notes 1000` or `--notes 10000`.
The script creates and validates removal of a uniquely named local temp fixture;
it accepts no Vault/runtime path. It uses actual shared catalog/graph classes,
bounded body reads, exact occurrence counts and revision checks. No production
Vault, NAS transport, external provider, model or alternative database is used.

Same-generator comparison against previously deployed `8635ef6f4` runtime:
1,000 documents / 19,360 links or 10,000 / 193,600; each target has 605 incoming
occurrences. Final repeated runs were sequential with no concurrent test command.
Each warm scenario has eight samples; cold initialization has one sample.

| Scenario, p50 / p95 milliseconds | Previous 1k | Modified 1k | Previous 10k | Modified 10k |
| --- | ---: | ---: | ---: | ---: |
| Repeated hot target | 16.751 / 21.813 | 3.343 / 5.675 | 160.025 / 171.914 | 16.499 / 26.976 |
| Eight-target fill pass | 16.384 / 17.496 | 17.668 / 23.651 | 153.222 / 167.048 | 156.732 / 164.641 |
| Eight-target reuse pass | 16.382 / 18.000 | 2.590 / 5.659 | 153.559 / 160.972 | 17.458 / 28.330 |

Cold initialization was 1481.901 -> 1427.646ms (1k) and 13198.130 -> 12727.408ms
(10k), not an established cold-start improvement. Peak RSS increased from
110.883 -> 111.496MiB and 211.645 -> 214.668MiB. All warm scenarios in both
versions read zero bodies; this is CPU work reuse, not an IO reduction. Cold
reads include initial batch invalidation (1,016 / 10,016 body reads), not an
assumption of exactly one read per document. Stats/SMB bytes are not measured.

All count/revision assertions and fixture cleanup checks passed. Initial runs
are retained separately; the first 10k baseline overlapped targeted tests, so
the sequential repeat above is the reported comparison. These bounded local
samples do not prove broad latency nonregression or NAS/full-service performance.

## Validation

The real-Markdown regression failed before the change (two complete fallback
scans instead of one) and passed afterward, including exact duplicates and
revision-bearing pages. Cache unit tests cover completion, empty hits, LRU limits,
oversize bypass, early exit, exceptions and overlapping admission. Graph tests
cover current source denial, unchanged-predicate ACL revocation, mid-read drift,
inspection budgets, filtered/compact projections, aliases, source changes,
moderation and deletion. Existing architecture contracts remain unchanged.
See the [execution record](../plans/2026-09-13-dense-backlink-cache.md) for final
full-suite, deployment and fork delivery evidence; this document alone does not
attest operational acceptance.
