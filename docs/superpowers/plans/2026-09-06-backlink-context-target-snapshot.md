# Backlink context target snapshot validation

## Defect and contract

Five real-file regressions demonstrated stale context/heading redaction after
a known neighbor was hidden/unhidden without a watcher event. An off-page
neighbor could also leave a fingerprint based on an outdated projection.
Root and author hash checks alone do not cover these dependencies.

## Implementation

- Collect matching physical lines and unique headings per included author.
- Resolve their references through full, visible and authorized hidden-fallback
  resolvers; use the same fallback policy as outlinks.
- Deduplicate authorized known target revisions, excluding already-guarded root
  and self references. Do not hash unrelated sections or scope-denied targets.
- Share the filesystem target validator: batches of eight, 8 MiB per complete
  read, allSettled drains in-flight siblings on failure.
- Keep outer generation/visibility and final root/page-author checks. Drift
  invalidates the target and returns the existing generic retry error.
- Preserve response shape, fixed five-tool surface, and authored Markdown.

## Verification

Real temp-vault tests cover hide/unhide, headings alone, off-page fingerprints,
denied bodies, alias shadowing, clipped context, unrelated sections, oversized
reads, deduplication, concurrency cap, permission/drift races and failure drain.
Run adjacent graph/trail/neighborhood tests, build, full suite, compiled MCP
smoke and diff check before committing source and generated dist together.

## Limits

This verifies known projection dependencies, not a complete resolver census.
Newly acquired aliases, attachment content and unobserved edits after hashing
remain outside the optimistic guarantee. Eight concurrent reads is per batch,
not a process-wide memory bound. No live Vault mutation or client setup needed.
