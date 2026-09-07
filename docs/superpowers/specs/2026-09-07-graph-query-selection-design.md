# Bounded graph query selection

Design approval is delegated by the user. Keep fork main only and do not restart
the live server or edit its Vault/config. This increment addresses actual query
work in VaultGraphIndex, not GPU acceleration or a whole-process memory cap.

## Evidence and choice

Backlinks use addTopMatch, an O(N*K) worst-item scan (K=offset+limit).
Outlinks filter all eligible edges into another array before slicing. Orphans
build zero counts for every note, materialize every orphan, sort an already
sorted visibility list again, and then slice. These are avoidable costs in
navigation/organization flows. More caching adds invalidation/memory overhead;
workers would duplicate state and add coordination. Reuse the existing bounded
heap for backlink selection and stream the other two result windows instead.

## Contracts

- Backlinks: O(N log K) selection, retaining only K ranked rows. Use path/line
  and encounter ordinal to make same-line ties deterministic in authored scan
  order, including at page boundaries. Existing source validation, count,
  fingerprint and post-await generation/visibility checks stay intact.
- Outlinks: scan all edges for visibility, total, optional fingerprint and
  target validation, retaining only the selected page. Fingerprint contributions
  can be accumulated before the validation await, as backlinks already do;
  nothing returns if generation/visibility validation detects a change.
- Orphans: track only normalized destinations with incoming edges in a Set.
  Self-links stay excluded. Iterate the already sorted visible note paths to
  count, fingerprint and retain only the page. Non-note files remain excluded.
- All current private-scope/moderation filtering and redaction remain. Totals
  and fingerprints cover the entire eligible view, not just the page. Offset,
  limit, source revisions and truncation semantics remain for valid inputs.
- No new MCP endpoint, derived cache, permissions, file format or dependency.
  Source graph/resolvers still consume memory and scans still visit all relevant
  edges; only selection complexity and intermediate result storage improve.

## Proof

Seed small synthetic graph read models (no real Vault access) and assert bounded
comparison work, no full link filter and no full orphan-row mapping/sort. First
run those tests on old code to RED. Verify expected full/page results, same-line
ties, hidden targets/sources, fingerprint page invariance and change rejection.
Existing filesystem-backed graph/navigation/security tests prove integration.
Build and full suite sequentially with one worker; independent read-only review;
explicit source/dist/doc staging, fork push and remote SHA confirmation.
