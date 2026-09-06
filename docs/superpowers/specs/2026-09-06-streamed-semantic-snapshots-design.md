# Stream semantic snapshots without whole-payload buffers

The user delegated design approval for this Goal. Preserve gzip JSON on disk,
the existing bounded reader and all source/scoping rules. No new dependency,
client installation or MCP tool. Scope this increment to semantic manifest and
pending-queue writes, where whole JSON/UTF-8/compressed buffers currently coexist.

Capture a shallow immutable-by-convention entry list before the first await:
manifest entries are replaced rather than mutated, and pending entries are
copied. Stream individual JSON records through one gzip transform with
backpressure to a unique sibling temporary file opened exclusively. Snapshot
inventory still costs O(N) references; this is not a constant-memory index.
Do not read mutable live entries later or serialize the entire inventory.

Enforce existing read-compatible stored/decoded byte ceilings while writing.
Count bytes, not characters. Only after the complete gzip footer is written and
the file closes, rename over the target. On failure preserve the previous target
and remove only this invocation's owned temporary file. Report a short generic
snapshot error, not source values or host paths. Concurrent invocations use
distinct temporary files: readers may see either complete generation, never an
interleaved or partially compressed file. Caller serialization/coalescing retains
generation order; do not promise crash durability/fsync beyond prior behavior.

Tests use real temp files/gzip and source services. Verify Unicode round trips,
empty snapshots, exact/overflow decoded and compressed limits, failed iterators,
rename failures and concurrent complete-file publication. Instrument JSON calls
to prove no whole-manifest or whole-queue serialization and demonstrate captured
generation consistency across async writes. No large stress allocation or live
Vault writes. Build, targeted/full single-worker tests and independent review
precede fork-only commit/push. Actual RSS savings require separate measurement.
