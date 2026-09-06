# Avoid redundant pending semantic work

Design approval and fork/main integration are delegated by the user. This
increment reduces organization-index maintenance overhead without extra client
steps, workers, caches or changes to Markdown authority.

Current `drain` spreads the complete pending Map before each selected path. With
5,000 ready entries and a four-file batch this visits 19,994 entries merely to
select four. Replace repeated materialization with one iterator, skipping future
retryAt entries and stopping at the existing maxFiles bound. Preserve insertion
order, selected entry objects, newer watcher intents and existing retry handling.
Retained selection memory becomes O(batch); worst-case eligibility scan remains
O(pending), with no heap or second queue to keep synchronized.

Current reconciliation reads/hashes changed sources even when an existing pending
intent already guarantees later preparation. After normal path validation and
stat, skip the body read for pending paths; keep the original manifest and intent
untouched. Drain still checks current file existence, parses current content,
enforces visibility and validates the final source hash before applying vectors.
Missing/read-failing/recreated sources remain governed by that same drain path.
No unqueued path receives the shortcut. Do not skip authoritative validation or
infer successful indexing from a queued event.

Scheduling invariant: the only production drain caller is runIdleWork, which
awaits the shared scanPromise first. An existing drain removes its complete batch
synchronously before doing asynchronous preparation. Therefore a source seen as
pending by a scan is not part of an already-running drain; a new drain waits for
that scan. Preserve this ordering if adding future callers. An edit after any
scan observation still relies on watcher delivery or a subsequent scan, as before.

Alternatives rejected: a priority heap adds synchronization/invalidation overhead
for a bounded 5,000-entry queue; extra read-result caches introduce freshness and
memory costs; more workers increase pressure without removing duplicate work.

Verify real-service selection iteration counts, delayed FIFO order, newer events
during a failed batch, pending scan body-read counts, unchanged manifest/retry
state, changed source drain output, read failure and unqueued discovery. Tests use
temporary Markdown and substitute only native apply/inference where necessary.
Run targeted tests, build, full one-worker suite and review before fork-only push.
Operation counts are not elapsed-time, RSS or desktop-stutter measurements.
