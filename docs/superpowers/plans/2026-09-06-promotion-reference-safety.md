# Public promotion reference safety

## Reproduced defects

Modern posts and completed tasks projected raw references into candidate lists;
task plans could route to hidden/private linked knowledge. Legacy discussion
hydration already filtered these references. Three real-file tests failed for
hidden, missing, private, traversal and service paths. Two further tests showed
owner/reference hiding during hydration could still return an obsolete plan.

## Shared behavior

- Keep the bounded metadata ranking pass; hydrate only winning sources.
- Resolve at most 50 raw reference inputs per winner. Validate paths and public,
  caller and source-to-target scope boundaries before fresh metadata reads.
- Exclude hidden/deleted targets. A private target is not public promotion
  context even if this caller can read it privately.
- Rebuild task review/publish plans from surviving public knowledge notes; never
  route an ordinary visible document as an already-linked durable knowledge note.
- Capture known visible source/reference revisions and verify them before any
  response branch. Deduplicate final checks, cap hashes at 8 MiB per file, drain
  batches of eight and reject drift without exposing target names in errors.
- Keep originals unchanged; promotion remains a proposal requiring evidence.

## Evidence and boundaries

Real-file coverage includes legacy/modern flows, own-private and foreign scopes,
Global/local Community URIs, missing/hidden/non-knowledge targets, races,
deduplication and drained failure. Build/full suite/compiled MCP are required.
The 8 MiB bound applies to final revision reads, not the existing metadata
inventory/hydration pipeline or whole-process memory. Ranking still uses authored
metadata hints, not an independently verified evidence/trust score. This is not
an atomic multi-file snapshot; unseen edits after verification remain possible.
Response compaction and malformed post/task identifiers need separate audits.
