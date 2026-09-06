# Source-checked graph reads

Seven disk-backed regressions failed before the fix: stale outlink source
contexts with/without requested revisions, stale backlink authors beyond the
returned page, a changed backlink target and root drift after graph capture.
The tests disable watcher startup and freeze refresh for one call, retaining
real parsed graph data and real edited files; restoring refresh proves recovery.

Shared filesystem backlink/outlink adapters request internal revisions, check
current source snapshots and invalidate detected stale entries. Public revision
fields remain opt-in. Matching backlink author metadata was already freshly
read for moderation; that same read now compares the graph hash before counts.
Final root and returned-page author hashes/access are checked before return;
page authors are deduplicated and checked in batches of eight. Derived graph
callback authors now receive their captured revision with the existing path.

Extra tests cover returned authors edited/hidden/deleted after capture,
unchanged public response shape, and deduplicated author reads. No new endpoint,
client installation, server restart, authority model or live Vault mutation.

Limits: these are optimistic selected-source checks, not an atomic graph census.
New matching edges missed by the watcher, unqueried resolver target changes and
standalone unresolved/orphan freshness remain separate audit work. Known hidden
or missing backlink authors are filtered as before; detecting ordinary changed
visible authors rejects rather than silently reporting an incomplete total.

Astra review reproduced destination-permission and observed target-hiding races
during the new final hash awaits. Three tests failed before adding the shared
graph stable-read wrapper, which now checks graph generation and visible path
membership after the complete filesystem validation operation.

Archive fixtures now model edits after the validated filesystem response to
keep exercising later-fresh-author recovery and incomplete scan continuation.
Raw obsolete-index tests assert the stricter rejection and refreshed retry.
The hash-count assertion is two fixed phases per selected author, not per link;
it is deliberately not reduced to one read by trusting a stale capture.

Upper-level trail/neighborhood cost assertions now count both source-checked
graph queries and their own final snapshot check, while retaining per-path
deduplication and fanout bounds. A concurrent change may be rejected earlier
by the graph barrier instead of the outer neighborhood snapshot validator.
The first full suite exposed three old single-phase read-count expectations;
an additional focused run exposed only this earlier error classification.

Compiled MCP smoke verified captured author revisions and no obsolete links
after an external file edit through both dynamic graph endpoints, with five
stable tools. The live watcher refreshed in that run (zero retries); separate
watcher-disabled tests prove invalidation/retry recovery. Temporary Vault removed.

Final verification: 15 source-snapshot tests; 89 tests across four related
suites; full suite 1619 passed and one skipped across 120 files (75.76s).
Build and staged diff checks passed. Astra re-review found the two reported
race gaps addressed by the outer stable-view barrier; reviewer closed.
