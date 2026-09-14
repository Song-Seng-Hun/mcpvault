---
id: repository-agent-edits
kind: project-rule
description: Bounded reads, revision-checked changes, lifecycle and resumable MOC paths.
keywords: [expectedRevision, change_set, lifecycle, continuity, 수정]
use_when: Editing or restructuring notes, deleting, retiring, or resuming a learning path.
position: Chapter 4 of 9; mutations after topic selection, before privacy review.
parent: ../../AGENTS.md
previous: policy.md
next: privacy.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Revision-safe reads and edits

The policy is guidance, not an access grant. Keep reads bounded with `limit`,
`maxChars`, cursors, section/block locators, and nearby context. Use
`expectedRevision` for edits, `notes.delete_preview` before deletion, dry-runs,
and returned revisions. Retire/reactivate via `wiki.lifecycle_transition`, not
triage/review/publish. Use `wiki.relation_set`,
`wiki.reciprocal_link`, `wiki.moc_order`, `wiki.hierarchy_change`,
`wiki.moc_membership`, or `wiki.property_migration`; dry-run its
`notes.change_set` and confirm the fingerprint. Git records it; Obsidian
visibility needs no commit. Reuse policy only while its fingerprint matches.
Pause a MOC path with `continuity.save` `learningProgress`; call
`continuity.resume` to validate drift before the next read.

Example: preview a relation change, confirm its fingerprint, apply and reread.
