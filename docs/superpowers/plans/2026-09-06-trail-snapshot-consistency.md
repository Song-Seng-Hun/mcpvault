# Trail snapshot consistency and converging routes

## Reproduced gaps

Ten baseline tests failed: Start/Mid/End edits, moderation hiding or deletion
after graph capture were not rejected, and two simple routes converging on
Mid lost the second route because traversal used a global visited set.

## Repair and constraints

- Request captured graph sourceRevision; retain it on each projected edge.
- Revalidate both endpoint snapshots and discovered route sources before
  returning, deduplicated with concurrency four. Reject mixed or unavailable
  revisions with a generic, path-free retry error. Scope URIs remain public
  identities even though traversal operates on authorized physical paths.
- Use path-local cycle checks, not a global visited set. Cache graph reads in
  the request to reuse common intermediates. Preserve depth/path/edge/output
  bounds, existing unique link resolution and source-to-target permissions.
- Zero-hop and empty routes still verify endpoints. No live Vault mutation,
  new endpoint, client setup, persisted cache, or atomic/exhaustive claim.

## Verification

- Initial ten regressions failed on the unchanged implementation, then passed.
- Added zero-hop, mixed endpoint, empty-path, authorized private route, and
  generic capture-error checks. Related trail/navigation/context tests: 44 pass.
- Build passed. Full suite: 1490 passed, 1 skipped, 111 files (73.65 seconds).
- Astra independently reviewed source checks, scope identities and bounds;
  30 trail/navigation tests passed in its separate run. No actionable issue
  was reported, and the reviewer was closed.
- Compiled dynamic MCP smoke verified five tools, both converging routes,
  edge source revisions, the 512-character budget and concurrent-edit retry.
  The owned temporary Vault was removed. Diff check passed; no client settings
  or live Vault data were changed.
