# Metadata index rebuild without retained bodies

The user delegated design approval and fork-main implementation/publication.
`VaultMetadataIndex.readEntry` currently uses the full-string reader solely to
parse Properties and compute a revision. The resulting index stores no body.

Reuse `VaultIoCoordinator.readUtf8Metadata` rather than introducing a new cache,
reader or pool. It delivers a header and revision from one decoded stream.
Parse the header per entry with the existing data-only handler. Remove only the
now-unused local full-string hash helper/import. No change to stat reuse,
normalization, filtering, caller visibility, generations, batch draining,
retry bounds, error sanitation, snapshot schema or index replacement order.

Full file bytes still have to be read/hashed. Header-only I/O would miss body
changes; separate header/hash reads would weaken same-stream provenance. Header
retention follows the existing collector's huge/unclosed-header behavior; the
index keeps its existing uncapped source policy in this increment. This is not
a process-memory ceiling or a new filesystem snapshot-isolation guarantee.

Proof: a pre-change RED test must show whole-body reader use on initialization
and dirty refresh. Tests must verify matching Properties and decoded revisions,
small parser inputs for large bodies, dirty body changes at equal size/mtime,
deletion during a read, batch error draining, concurrent refresh deduplication,
and snapshot reload correctness. Existing metadata-refresh race hooks must move
to the real projection boundary, preserving their mutation/error timing.

Run focused tests, build, independent integrity review and full single-worker
suite sequentially. Preserve unrelated local state and all running servers.
Document scope, commit generated dist with source, push only the user's fork,
verify remote SHA. This does not complete the broader active Goal.
