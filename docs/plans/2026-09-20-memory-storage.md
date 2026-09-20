---
id: memory-storage
kind: operations-manual
description: Local worker-backed memory discovery and explicit coverage limits.
keywords: [SQLite, worker, correction, memory, 백만, 색인]
use_when: Enabling or diagnosing bounded memory retrieval.
position: Storage chapter after the memory flow contract.
parent: 2026-09-20-memory-flow.md
previous: 2026-09-20-memory-flow-contract.md
next: 2026-09-20-memory-grounding.md
---
# Disk memory discovery

Set `MCPVAULT_MEMORY_CACHE_DIR` to an existing private local host directory.
Node 22.23.2+ is required. Do not place SQLite on NAS or inside the Vault.
No setting: retain the legacy small-Vault path and its 10,000-note guard.
This setting grants no document access, model execution or new account binding.

One SQLite worker owns metadata, multilingual substring postings and inverse
support/correction edges. Bodies remain authoritative on NAS; vectors stay in
the existing semantic service. No per-request full metadata inventory is built.
An OS-released exclusive lock prevents competing scan writers.
Background preparation streams directories, with at most eight source reads.
Unchanged revisions skip body reads. Failed batches drain before stopping.
Events coalesce by path; overflow requests one background reconciliation.
Index jobs retain the service owner's context, not an expired request session.
NAS loss is unavailable, not deletion. Interrupted scans cannot sweep rows.
Damaged/schema-unknown databases fail closed; never silently initialize history.

Queries intersect scope, prefix, role and event dates before bounded pages.
Opaque access predicates are checked within at most 256 inspected candidates.
Semantic discovery adds a separate bounded contextual pool, not just literal hits.
Channel ranks use equal RRF, k=60, at most 20 candidates per channel.
Inverse dependencies outside a selected folder are checked with current access.
Limits: 200 dependencies, correction depth 8; incomplete chains return partial.
Current source bytes, policy and index generations are checked before delivery.

## Use and limitations

Example: `memory.recall {scope:"personal", query:"NAS", semantic:false}`.
Use `pathPrefix`, `role` and dates to narrow a partial candidate partition.
Preparing/unavailable indexes return explicit partial packets, not full scans.
Exact reads remain available through authorized source actions.
Quoted/structured queries return partial in disk mode; use authorized source reads.
Private-source execution exclusions remain enforced; this is not a new ACL.
The disk path is optional pending corpus-level quality measurements.
SQLite-only scale results do not certify the whole Vault, ANN or model quality.
Unrelated legacy indexes still have their existing scale limits.
