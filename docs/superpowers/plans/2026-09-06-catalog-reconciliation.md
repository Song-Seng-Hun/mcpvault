# Catalog inventory reconciliation and recovery

## Reproduced gaps

Seven real-file tests failed on the baseline: a live watcher losing nested
add/delete/rename events left the root stat unchanged, so cached subtrees hid
new/deleted notes. Restored local directory mtimes also fooled entry reuse.
Graph backlink discovery inherited that stale inventory. Frequent hot-folder
refreshes reset the reconciliation deadline, and scans invalidated during
enumeration still returned their uncommitted inventory to the caller.

A separate deferred-reader regression proved failed directory batches returned
before sibling cache writes completed. Astra review then identified recovery
after exhausted retries: a real after-readdir hook renamed a file three times
while restoring directory mtime; after the bounded error the next query returned
New2.md instead of the current New3.md. That regression also failed before fix.

## Implementation

- Track successful full-census time independently of incremental refreshes.
- On an overdue inventory query, bypass subtree and entry caches for allowed
  directories. Normal clean reads share snapshots; incremental updates reuse
  untouched subtrees. There are no catalog note-body reads or new client tools.
- Publish only generation-checked inventory; drain received events and retry
  up to three times. Reject rather than returning uncommitted results.
- Keep forced reconciliation on the catalog across failed/exhausted requests,
  clearing it only after a successful full census.
- Drain each failed recursive sibling batch before releasing the shared
  refresh promise. Cleanup is promise-identity checked.

## Verification matrix

- Real watcher with change events suppressed, unchanged ancestor stats, nested
  add/delete/rename and restored-directory-mtime cases.
- Graph incoming links, shared metadata filters and lexical search discovery
  and removal through the current catalog inventory.
- Hot-folder refreshes cannot postpone census; warm concurrent reads share
  snapshots; twenty overdue callers share one scan; incremental updates retain
  untouched-subtree reuse; restricted nested folders remain excluded.
- Received mutation during enumeration, bounded persistent churn, next-request
  recovery after exhausted retries and a failed incremental sibling batch.
- Build, full suite, diff check and isolated compiled services/MCP smoke.

## Limits

The periodic scan is query-triggered (60 seconds with catalog watcher, five
without), not a daemon. It lists directories rather than hashing note contents.
Other indexes retain their own content reconciliation and authorization checks.
This does not establish a whole-Vault atomic snapshot, a global directory-I/O
concurrency cap, or protection against every unobserved edit during enumeration.
All-stat-preserved content changes and source/target identity freshness remain
separate audits; existing public endpoints and source revisions are unchanged.

## Verified results

- Dedicated reconciliation suite: 16 passing real-file tests. Original seven
  regressions, sibling-drain regression and exhausted-retry recovery regression
  each failed before their corresponding production change.
- Focused catalog/graph/metadata suites passed; `npm run build` passed.
- Final full suite: 1,649 passed, one skipped across 122 files (75.64 seconds).
  One earlier expanded-suite run failed only because a new test expected an
  internal error string instead of the existing public read-unavailable error;
  its expectation was corrected without weakening the production error wrapper.
- Compiled isolated-vault smoke: missed nested rename and deletion repaired
  across graph, metadata and lexical search with ancestor mtime unchanged and
  nested-directory mtime restored. The MCP adapter retained five tools and
  returned the expected empty backlinks after deletion.
- Astra review reproduced the exhausted-retry gap, then reviewed its fix and
  the unchanged-subtree/failed-sibling tests without further actionable findings.
  Reviewer closed; no live Vault, credentials, upstream or PR changed.
