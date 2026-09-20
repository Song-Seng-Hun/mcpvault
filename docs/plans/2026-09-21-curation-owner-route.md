---
id: curation-wiki-owner-route
kind: execution-record
description: Explicit wiki-owned compilation and relation cleanup; live eligibility is separate.
keywords: [curation, wiki_knowledge, publication, managed receipt, 지식 정리]
use_when: Connecting Community Knowledge outputs without relaxing general migration rules.
position: Owner-service chapter; a prerequisite, not C1-C3 completion.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-scoped-graph.md
next: 2026-09-20-curation-contract.md
---
# Wiki-owned output route

Baseline: main 330f4dd70. Existing runtime and account; no new binding.
General compilation and chapter migration still exclude Community records.
An optional compilation project outputOwner=wiki_knowledge selects the existing
publication adapter for exact Community/Knowledge/*.md outputs, not a glob grant.
Every configured path is exact. Other service roots and nested originals fail.
Owner projects cannot add chapterBundles; generic output projects stay compatible.
The registered adapter, write/publish capabilities, source policy and verified
runtime remain mandatory. Host configuration alone does not attest execution.
The current CLI has no synthesis verifier; this route does not invent one.
Owner identity participates in admission fingerprints and managed receipt checks.
An existing document without matching managed history is not automatically adopted.

## Curation handoff

The separate existing evolution curation grant accepts owner=wiki_knowledge only
for deduplicate_relations and exact knowledge paths. No default grant is installed.
The wiki owner produces a read-only intent; existing change-set and evolution
services apply, reread, journal and restore it with current authority/revisions.
Remove only identical relation strings. Keep aliases, anchors, rationale,
evidence, prose and nonduplicate direct edges unchanged.
Keep the 200-occurrence bound. Incomplete inspection never authorizes a write.
Stored intents are reconstructed from pinned originals before reuse. Unexpected
patches, metadata changes, removal counts or output hashes invalidate the journal.
Community merging, archiving, splitting and deletion remain excluded here.

## Current evidence

Targets include real publication service writes in isolated test Vaults, receipt
loss, restart, manual edits, disconnected owners and permission withdrawal.
These tests are not actual NAS changes or independent model evaluations.
Normal authenticated live inspection found one visible historical experiment note.
It lacks managed knowledge classification and duplicate relations. Leave it intact.
NAS runtime deployed; authenticated reads/diagnostics passed. Access settings unchanged.
Actual curation applied / next-use effects remain 0 / 0.
Full: 560 files, 7,381 passed / 4 skipped / 0 failed; build passed. One same-source run.
Full C1-C3 acceptance, next-use proof and retrieval-quality evaluation remain open.
Skill metadata: last 186/1610 (11.55%); active 0/1610 (0%); not recounted.
