---
id: context-architecture-migration
kind: implementation-contract
description: Preprocess every admitted document and activate only verified chapter bundles.
keywords: [inventory, translation, revision, rollback, NAS, bundle]
parent: README.md
previous: 01-content.md
next: 03-routing.md
---
# 2. Migration

Metadata-first inventory: general, managed projection, source-only, current,
review-required or unavailable. Inventory discovery grants no execution rights.
Freeze admitted inventory; coalesce later changes into an incremental queue.
Never report hidden names, existence, counts or departments outside their ACL.

## Per-document sequence

1. Refresh source/metadata/access/evidence revisions.
2. Preserve original bytes and recovery manifest; reread and verify hashes.
3. Partition Markdown semantically; pin names/conditions/literals/references.
4. Current approved session generates English bodies and separate cards.
5. Record mechanical checks and meaning review separately.
6. Store inherited restrictions before any derivative body.
7. Stage chapters; verify complete bundle, outline, anchors and revisions.
8. Preview/fingerprint/revision-check the final owner-service cutover.
9. Reread results and persist completion receipt before reporting complete.

Source-only: no translation/synthesis; exact reads and allowed extracts only.
Session end leaves durable pending work; never spawn another generator.
Unverified translation never replaces the current source.

## Compatibility and recovery

Keep old paths and heading/block/alias mappings. Oversized compatibility outlines
or uncertain external anchors block automatic cutover, not derivative preparation.
Rewrite only resolved accessible links; never code examples or ambiguous names.
Stable IDs survive unambiguous edits; uncertain resegmentation gets new IDs.
Do not multiply logical document/task/claim/MOC counts by chapter count.
Historical evidence resolves the old snapshot, never relabels newer English text.
Manual output edits stop overwrite. Rollback verifies owned current output first.
Existing change sets stay bounded (10 existing notes); create chapters separately.
Cut over original path last. Incomplete bundles stay out of default search.
No assertion of NAS-wide multi-file atomicity. Old body stays readable on failure.

Bundle manifest fixes inputs/rules/authority/name dictionary/output generations.
Reuse single-output compilation jobs beneath it; complete only all required jobs.
Page durable jobs/receipts; copy+verify legacy history, never reset corruption.
One worker/bundle at a time; stop after 3 failures; at most 1 meaning refinement.
Managed roots retain restrictions and use their owning service, not generic writes.
