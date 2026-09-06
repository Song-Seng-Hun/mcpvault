# Preserve projection freshness during response compaction

## Evidence

The service correctly computed summaryFresh/summaryStale against its captured
body, but boundedWikiProjectionResult discarded both while reducing response
metadata. A short response could show old summary text without its stale flag.
Eight new MCP tests reproduced this loss before the production change.

## Contract

Preserve these computed boolean facts, including false values, in the mandatory
compact envelope. Do not infer freshness from authored fields or invent facts
for notes without progressive metadata. Stored metadata may be stale while a
body_excerpt is current source. Matching digests do not prove factual truth.
Keep source revision and guarded recovery; if the mandatory envelope does not
fit, use the existing bounded retry error rather than discard interpretation
facts. No source, stored fingerprint, access control or MCP surface is changed.

## Verification

- Eight RED cases then GREEN: stale summary/key-points/progressive/full views,
  fresh projections with compact/pretty input, absent fingerprint and a current
  excerpt beside stale blank metadata. An ordinary-note absence case stayed green.
- Added authored-flag spoofing and concurrent-edit checks: freshness and recovery
  reference the captured revision, and recovery rejects a changed current source.
- Targeted excerpt/projection integrity suite: 51 passed.
- Final build passed. Full suite: 1,886 passed, one existing skip, 139 files,
  79.16 seconds. Compiled five-tool MCP smoke verified fresh/stale/absent facts
  with compact and pretty requests bounded to 512 characters, including pinned
  recovery. The isolated temporary Vault was cleaned.
- Focused read-only review found no issues in boolean preservation, computed
  provenance, response budget enforcement or split-preview compatibility.
  Reviewer closed after completion; no live Vault/server changes.
