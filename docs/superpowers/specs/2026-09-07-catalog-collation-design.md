# Reuse a default collator for catalog sorting

User approves design/main integration. Current stable census sorts notes/all
with a.localeCompare(b) for every comparison. Existing generation guard already
skips obsolete censuses. Keep that guard and the native stable sorting algorithm.

## Decision and compatibility

For a valid inventory containing at least two items in either array, construct
one default Intl.Collator and reuse its bound compare function for both sorts.
Construct after the generation check, not per catalog/agent or comparison. Do
not pin a locale or introduce numeric/case/normalization options. Empty/singleton
inventories need neither a collator nor sorting. When Intl/Collator is absent
(custom Node builds), retain the former localeCompare callback. No workers,
external dependencies, async boundaries, or persisted locale metadata.

ECMA-402 defines localeCompare through the same default Collator/CompareStrings
operations: https://tc39.es/ecma402/#sec-string.prototype.localecompare . Engines
may optimize away internal objects; do not claim a constructor per old comparison.
Node documents optional ICU builds: https://nodejs.org/api/intl.html . Ordering
continues to depend on the runtime's default locale/ICU, not global byte ordering.

Alternatives: custom merge sorting needs extra buffers and complex yield/cancel
ownership; worker sorting transfers arrays. Comparator reuse is smaller and has
measured benefit without either cost, but final sorting remains synchronous.

## Local exploratory evidence

Node22.23.2 / ICU78.2 / ko-KR. 10,000 synthetic paths; three warm-up rounds and
nine measured rounds, alternating variant order. Median milliseconds:

| corpus | localeCompare callback | reused compare |
| --- | ---: | ---: |
| ASCII | 19.6727 | 11.0260 |
| mixed CJK/emoji/Latin | 22.3621 | 13.5123 |

Each result was compared element-by-element with native localeCompare ordering.
Sort-only microbenchmark, not full-catalog, RSS, event-loop or whole-PC evidence.
Dataset: prefix Note or [Alpha,한글,文書,🧠,é,Zebra][i%6], then '/' followed by
((Math.imul(i,7919)>>>0)%100003) and '.md'; i=0..9999. Array copying excluded
from timings. Comparator construction excluded; production constructs once per
valid nontrivial census, so verify integrated construction count separately.

## Tests

Real temporary mixed-language files, watched/unwatched modes; unchanged path
order, one default constructor and no String.prototype.localeCompare dispatch
during sorting. Warm snapshots need no construction; after invalidation one more
constructor suffices. Empty/singleton and stale census construct none. Simulate
missing Intl.Collator to prove fallback preserves former behavior. Keep existing
cooperative/close/generation/reconciliation tests and run full suite one-worker.
