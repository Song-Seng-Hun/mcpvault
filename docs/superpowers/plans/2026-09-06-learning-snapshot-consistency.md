# Learning source snapshot consistency

## Evidence

Five real filesystem races modified a nested MOC, hid a nested MOC, hid or
deleted a selected leaf, or revised an external prerequisite after queryNotes
returned metadata. All five returned a mixed/stale path without rejecting.
Nested traversal silently replaced the old revision with the new one while
retaining old metadata, and did not check the new moderation state.

## Implementation

- Require the captured revision and visible moderation state before parsing a
  nested MOC; do not silently replace its revision.
- Capture distinct selected entry and resolved prerequisite revisions,
  including targets used for missing/ambiguous claim diagnostics.
- Revalidate those sources in batches of four before the existing final root
  check and both public/checkpoint-only return paths. Source failures produce
  a path-free error. Existing checkpoint preparation rejects before writing.
- Avoid revalidating unrelated notes; shared prerequisites are checked once.

This is observed drift rejection, not an atomic filesystem snapshot. Changes
after each check and to unselected resolution candidates may escape detection.
Four is a concurrency cap, not a total I/O cap: the worst bounded route can
approach 7,550 distinct sources. Existing discovery costs are unchanged.

## Validation

- Five initial red races pass after the fix.
- All five races also reject actual checkpoint replacement while preserving
  the previous stored revision.
- Indexed and no-index positive fixtures verify correct authored order,
  concurrency at most four, one read per selected leaf/shared prerequisite,
  and no revalidation read of the concurrently edited unrelated note.
- Targeted snapshot suite: 12 passed. Build passed.
- Astra review found no blocking issue; documented its non-atomic/I/O caveats
  and added its requested existing-checkpoint/indexed regression coverage.
- Final full suite: 1418 passed, 1 skipped, 106 files (74.98 seconds).
- Compiled dynamic MCP race smoke hid a nested MOC after metadata capture;
  checkpoint replacement returned a path-free retry error without the hidden
  marker and preserved the existing checkpoint revision. Fixture and account
  removed; reviewer closed. Build and final diff check passed.

No live Vault data or server configuration changed; fixtures are disposable.
