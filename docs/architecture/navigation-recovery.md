# Navigation recovery and maintenance scan reuse

Baseline: `149f08f09`. This change implements three priorities from the next
cross-model feedback review. It does not implement all seven proposed axes.

## Task recovery

`notes.task_update` still refuses stale revisions. A structured
`task_reanchor_required` error carries the current revision and a pinned
`mcp.read_note_lines` action. At most one unique explicit block ID can supply a
candidate line. Content IDs, duplicate block IDs, and stale line-only locators
do not establish identity across edits; no text similarity or automatic retry
is used. Task text is not copied into diagnostics or audit errors.

The service checks moderation before exposing revision conflicts and checks
the snapshot again before constructing a diagnostic. The MCP adapter audits
the refusal, then rechecks body revision, moderation, current path access and
authentication at response release. Existing mutation capability, read-only,
immutable source and final revision guards remain unchanged. A pinned read is
an instruction to inspect, not proof the old requested edit is still appropriate.

## Graph maintenance

`findUnresolvedLinks` and `findOrphanNotes` reuse exhaustive scan results within
the existing generation/predicate/visible-membership context. Each scan cache
retains at most 4,096 occurrences or paths; an oversized scan streams fully and
never commits a prefix. The existing bounded occurrence-cache helper is reused.
Cold orphan topology still uses a document-sized incoming set. These are logical
reference caps, not a process-wide memory or byte cap.

Every call still runs reconciliation and current visibility membership checks.
Candidate filters, projection/redaction, count, paging and fingerprint construction
are outside the cache. Final membership/generation checks reject synchronous
callback drift. Cached rows are never returned by reference. Hidden targets,
private scope links and generated navigation keep their existing treatment.
This avoids repeated resolution scans, not all O(N) work or all NAS stats.

### Local synthetic measurements (2026-09-13)

Sequential processes compared the retained baseline release with this build.
Fixture: N-1 documents form a directed ring, one document is orphaned, every
50th ring document has one unresolved anchored Korean/emoji link. Shared catalog,
single-reader coordinator, exact totals and equal response fingerprints checked
for all eight warm samples. Fixtures were temporary and safely removed; no live
Vault was used. Timing includes fresh projection and final membership checks.

| Warm query | 1k baseline p50/p95 ms | 1k new | 10k baseline | 10k new |
| --- | --- | --- | --- | --- |
| Unresolved (20 / 200 occurrences) | 3.525 / 5.235 | 1.425 / 2.365 | 25.345 / 36.352 | 17.055 / 20.880 |
| Orphans (one result) | 2.264 / 3.035 | 0.258 / 0.420 | 18.461 / 22.249 | 2.420 / 3.231 |

Warm body reads were zero for both versions. Peak RSS was 80.31/80.52 MiB at
1k and 138.53/138.96 MiB at 10k. This sparse fixture, eight samples and local disk
do not establish NAS latency, write-heavy reuse, dense-graph speedups, or memory
guarantees. Deterministic traversal regressions are in
`src/graph-maintenance-cache.test.ts`; private raw measurement tooling remains
with host deployment artifacts, not the shipped runtime.

## Continuity: targeted review contract, not automatic understanding repair

Stale learning progress now includes up to eight current-revision read actions,
an explicit omitted count, route/dependency review requirements, and the fields
needed for the existing `continuity.save` endpoint. Unchanged completed progress
is retained. The client reviews only the changed sources as needed, follows
bounded-read continuations, reviews the route when required, and submits its
own reviewed checkpoint using the current checkpoint revision.

`sourceRevisionFingerprint` can cover sources beyond the changed entry list.
Consequently source-snapshot or structure changes require path review; the
server does not infer that rereading one leaf validates all dependencies.
`understandingVerified` remains false and `canResume` remains false until the
existing checkpoint and understanding checks succeed. This batch does not add
`revalidatedPaths`, automatic stale-to-ready transitions, or silent checkpoint
rebasing. Small responses omit the entire recovery detail and preserve the
stale/incomplete state. Unchecked or unavailable paths produce no new actions.

## Review and scope

The two changed architecture-manifest hashes were updated after solo source
review: fixed tools, service ownership, authorization and source-protection
boundaries remain in place. No independent agent review is claimed.

Community thread caching, real-model multi-turn evaluation and broad MOC module
relocation remain separate work. Existing I/O concurrency (initial 8/max 32)
and centralized relation definitions were not duplicated. No new provider,
automation activation, Telnet, PR or upstream publication is part of this batch.
Full regression and live delivery receipts are recorded in the execution plan.
