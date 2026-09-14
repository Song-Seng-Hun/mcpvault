---
id: adaptive-retrieval-08-delta
kind: research-proposal
description: Revision-pinned deltas and safe fallback to full chapter reads.
keywords: [retrieval, statechart, scale, context, 검색]
use_when: Evaluating revision-pinned deltas and safe fallback to full chapter reads.
skip_when: Seeking an approved runtime contract or measured production capacity.
position: 8 of 14; see parent for navigation.
parent: README.md
previous: 07-exposure.md
next: 09-feedback.md
status: proposed-not-implemented
---
# Revision-safe context deltas

Use deltas only against the recipient's acknowledged exact representation and retained range.
Bind base/target revisions, document/chapter ID, old/new locators and both representation hashes.
Source revision alone is insufficient after translation/compression rule changes.
Current policy must permit both sides; a diff cannot reveal denied historical text.
Reuse bounded source-delta hunks, separating normalized rendering from raw-byte provenance.

## Delivery rules

Show changed complete clauses with nearby conditions and stable read actions.
Preserve removals: deletion of “must not” is important, not an empty update.
Include exceptions, units and dependencies when changes alter their interpretation.
Never split a fence, quotation, example or condition mid-unit to satisfy a token budget.
If delta cost exceeds a current chapter read, return the chapter.
Missing, stale, partially retained or unverifiable base -> bounded current read.
An applied delta receipt covers only its confirmed target range, not the entire document.
A dropped response cannot advance the consumer cursor.
Bound delta-chain length; use fresh bounded checkpoints across sessions.

## State and permission

“Verification pending -> passed” requires the actual new evidence reference.
Schema changes can invalidate tool arguments without a document-body change.
Revocation returns only opaque invalidation permitted by current policy, not hidden titles or old text.
Candidate-cache invalidation must include new eligible documents, not just last time's returned sources.
Otherwise a new contradiction is missed while every old source remains unchanged.
Use relevant partition/dependency generations with conservative invalidation when dependencies are unknown.
Measure delta construction/transmission and downstream token saving separately.
Negative example: a10-line read does not establish a base for the other40lines of a chapter.
A client saying “already read” never bypasses required-read or revision validation.
