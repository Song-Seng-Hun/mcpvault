# Outlink target snapshot verification

## Reproduced failure

The source hash can remain current while known target aliases/moderation change.
Five real-file regressions failed on the baseline: newly hidden targets remained
in off-page counts, hidden targets stayed excluded after unhide, alias metadata
changes went unchecked, and deleted targets left an unvalidated resolver view.

Astra review identified two shadowing cases and an oversized-read risk. Each
was reproduced with real files before its fix: a denied exact name hid a visible
fallback from dependency collection; a cached hidden fallback similarly stayed
unchecked after unhide; and a cached target grown to 8 MiB + 1 was read through
the unrestricted reader before rejection.

## Implementation

- Internal optional graph callback collects distinct known authorized target
  revisions from full, visible, and authorization-only hidden-fallback resolver
  matches. Validation does not grant projection visibility or read denied scopes.
- The filesystem adapter always supplies this callback and uses the existing
  access/revision guard with an 8 MiB bounded reader, drained in batches of eight.
- Drift invalidates the affected graph entry and fails with a path-free retry
  error; the next query refreshes it. Source/self links keep the existing root
  check instead of duplicating a target check.
- The graph verifies generation/visibility after callback awaits; the outer
  filesystem barrier remains through final source hashing.
- Optional byte limits on readNoteRevision use the same path/error handling;
  callers omitting the limit retain existing behavior. No public MCP schema,
  response target body, or target-revision field was added.

## Tests and scope

The dedicated 14-test suite exercises all baseline/review cases, denied-path
non-reads, repeat/alias deduplication, off-page checks, eight-way batching,
observed permission/content races, and sibling draining on failure.
Trail expectations now account for graph source + target checks separately
from deduplicated final path validation. Neighborhood still verifies its final
snapshot at concurrency four; its parallel graph reads can overlap eight
outlink target checks with one backlink root check. No unrelated files are read
by those target hash checks in the tested fixtures.

Known limits: newly gained aliases on unrelated notes, attachment contents,
backlinks' neighbor-reference target freshness, and unobserved edits after final
hashing remain separate audits. The graph-only API without the callback is still
an advisory read model. Cost is proportional to distinct referenced targets;
eight reads per query and 8 MiB per target are not a process-wide memory cap.

## Verified results

- Dedicated real-file regressions: 14 passed. Initial five stale-target tests,
  both reviewer-requested shadowing transitions and the bounded-read test failed
  before their corresponding fixes.
- Target/source/trail/neighborhood focused coverage passed; build passed.
- Final full suite: 1,663 passed, one skipped, 123 files (79.67 seconds).
  Earlier upper-layer read-count tests were adjusted to distinguish target
  dependency verification from their unchanged final-snapshot deduplication.
- Compiled isolated-vault smoke verified off-page hidden target rejection,
  shadowed alias unhide recovery, zero reads of the scope-denied target and
  bounded rejection after a target grew to 8 MiB + 1. The compiled MCP adapter
  kept five tools; its outlink response was 303 characters under a 1,500 budget.
- Astra reviewed and reproduced the fallback/size gaps and confirmed the final
  targeted fix. Reviewer closed. No live Vault, credentials, upstream or PR
  was modified. `git diff --check` passed.
