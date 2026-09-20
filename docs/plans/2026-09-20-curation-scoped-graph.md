---
id: curation-scoped-graph
kind: execution-record
description: Disk-indexed one-note relation inspection; not global impact certification.
keywords: [SQLite, aliases, graph_health, neighborhood, 관계, 별칭]
use_when: Inspecting current outgoing relations without a whole-Vault report.
position: C3 read-path continuation after local compilation processing.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-local-processing.md
next: 2026-09-20-curation-scoped-measurement.md
---
# Scoped graph inspection

Starting commit: 768ef982b. Existing main; no host grant or Vault content changes.
## Implemented

- `wiki.graph_health(path=...)` selects the existing outgoing assertion view.
- Without path, the legacy whole-Vault report retains its existing behavior.
- `wiki.neighborhood(view=assertions)` shares the same service and checks.
- Configured private SQLite now indexes ordinary factual Markdown identities.
- Path, filename, title, aliases, preferred term and stable ID use indexed keys.
- Each key admits at most 65 candidates; current visible identities resolve them.
- Ambiguous/overflowing lookup is partial; never choose an arbitrary unique hit.
- Candidate revisions, protected access and index generations are rechecked.
- Index preparing/failure never falls back to a foreground alias inventory scan.
- Names preserve multiple spaces, Korean aliases and existing path semantics.
- Root-qualified Markdown reverse keys now match the shared live resolver.
- Legacy graph rows and missing identity extensions receive explicit backfill.
- Graph-only rows stay out of optional memory results.
- Source/anchor checks and response budgets remain in the existing packet builder.
- Host storage is verified at capture/release, not once for every alias lookup.

## Boundaries

This is outgoing discovery with current locators, not independent fact validation.
An empty result does not certify no incoming links or authorize archive/merge.
The current mutation gate still requires complete guarded impact inspection.
Incoming public paging and global curation impact capture remain unfinished.
No changes to accounts, certificates, grants, protected originals or skill quarantine.
## Verification

Targets: 11 files / 97 passed, including core-only MCP and root-page continuation.
Build/full coverage: 560 files, 7,364 passed / 4 skipped; basis 70d96d9b.
One native DB test exceeded 5 seconds; unchanged 27-test rerun passed, initial failure retained.
Live release: 20260920-curation-scoped-graph-final. Scoped read/paging passed; graph partial.
Original/world/economy bytes and rollback release preserved; no new host grants or bindings.
[Final 100k/1m storage measurements](2026-09-20-curation-scoped-measurement.md); not live impact proof.
Actual NAS curation / next-use effects: 0 / 0.
Skills (last record, not recounted): metadata 186/1610 (11.55%); active 0/1610 (0.00%).
