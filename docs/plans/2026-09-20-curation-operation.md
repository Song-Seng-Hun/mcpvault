---
id: curation-operation-guide
kind: procedure
description: Existing evolution cycle path for receipt-managed exact relation cleanup.
keywords: [curation, deduplicate_relations, recovery, 관계 정리]
use_when: Running or resuming the deterministic cleanup operation.
position: First executable operation; not the merge/split/archive implementation.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-status.md
---
# Managed relation cleanup

Use evolution.cycle with kind=curation. Fixed MCP tools remain unchanged.
Start: op=diagnose. A connected service is not automatic permission.
Host evolution config may include curation grants: accountId, exact paths,
operations=[deduplicate_relations]. Wildcards, originals and service paths are denied.
No grant is created by this implementation or by an endpoint argument.
Current compilation history must prove ownership of the exact input revision.
Manual changes invalidate ownership; managed=true in Markdown proves nothing.

## Explicit execution

1. Read the current accessible knowledge note and source revision.
2. prepare: cycleId, requestId, expectedRevision=missing, operation,
   path, sourceRevision. Only identical repeated relation strings are candidates.
3. Inspect returned fingerprint and removedOccurrences. No unique target is removed.
4. apply: same cycleId, fresh requestId, returned expectedRevision and fingerprint.
5. Reread the note. Applied means output and durable receipt were checked.
6. Search and next-use effects require separate evidence; they are not inferred.

Example: ["[[B]]", "[[B]]"] becomes ["[[B]]"].
Counterexample: [[B|Alias]], [[B]], [[B#Condition]] remain distinct.
Do not use this operation for semantic merging, automatic retirement or deletion.
More than 200 relation occurrences returns partial/review_required without writes.

## Recovery

read/preview returns bounded status, never host paths or rollback source text.
An uncertain write stays applying/reverting. Use reconcile with current revision.
Reconcile checks actual bytes; it does not replay an old patch.
revert restores exact preserved bytes only while current output is still owned.
User edits, revoked grants/permissions or unavailable NAS block apply and restore.
Repeated completed request IDs do not perform another mutation.
No model, account, certificate, scheduler, installation or additional MCP is created.
