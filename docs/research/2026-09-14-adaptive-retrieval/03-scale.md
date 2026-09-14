---
id: adaptive-retrieval-03-scale
kind: research-proposal
description: Disk-backed indexes and bounded million-document working sets.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating disk-backed indexes and bounded million-document working sets.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 3 of 14; see parent for navigation.
parent: README.md
previous: 02-planner.md
next: 04-state.md
status: proposed-not-implemented
---
# Million-document storage

A million documents may produce5m chunks; distinguish logical documents from physical rows.
Arithmetic at384dimensions:1m float32 vectors=1.536GB;5m=7.68GB, excluding all metadata/index overhead.
Int8 payload would be0.384GB/1.92GB; this is not a measured engine footprint or promised index format.
Quantization needs recall evaluation, raw-vector refinement and bounded resident memory.
Do not promise the present16GB host fits this workload alongside all other applications.

## Layout

Canonical Markdown/immutable evidence stay on NAS; permitted derived indexes live on host SSD.
A local derivative is not a recovered Vault or a new synchronization source.
Partition by validated storage/security domain and embedding profile first.
Use bounded size-based segments inside a domain; projects/topics/genres are normally indexed filters.
Do not create every project x phase x intent x language combination as a table.
Do not build a fresh ANN index per request; reuse indexes with supported native filters.
Do not duplicate vectors for overlapping department memberships.
Trusted ACL postings express membership; labels and client claims never grant access.
Use integer document/chunk IDs and dictionary-backed paths to avoid repeated strings.
Return internal generation-pinned candidate handles, not million-element path arrays.
Handles are short-lived, server-owned and reauthorized, not bearer permissions.
Try supported LanceDB scalar/vector indexes before a backend replacement.[S2]
DiskANN motivates SSD-backed search beyond RAM; published hardware results are not NAS promises.[S3]

## Updates and load control

Use immutable index segments, a bounded update/delete overlay and revision manifests.
Reuse unchanged chunk embeddings; model/profile changes require explicit reindexing.
Persist coalesced update cursors; never turn a foreground search into full-corpus reconstruction.
Reconcile watcher gaps incrementally; NAS disconnect means uncertainty, not deletion.
Prioritize revocation and interactive reads over compaction/background embedding.
Recheck rights before hydration and response; denied late rows cause bounded refill or partial.
Bound native/JS memory, file descriptors, fan-out and write amplification together.
Exact global aggregates are separate paginated jobs; ordinary top-k must not compute them.
Unknown freshness fails closed for private output.
No claim of instantaneous observation of arbitrary direct NAS writes.
Million-file Obsidian/NAS navigation is a separate compatibility gate, not solved by vector indexing.
