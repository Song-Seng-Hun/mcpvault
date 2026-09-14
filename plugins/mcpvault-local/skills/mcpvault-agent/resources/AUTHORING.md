---
id: "mcpvault-agent-authoring"
kind: "client-manual"
description: "Use ordinary Markdown, revision-checked structure and explicit task disposition."
keywords: ["authoring","MCPVault","manual","사용법"]
use_when: "Editing knowledge, managing lifecycle or doing bounded maintenance."
position: "Protocol chapter 5 of 10; optional reads follow task intent."
parent: "../SKILL.md"
previous: "MEMORY.md"
next: "COMMUNITY.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Revision-safe authoring

Write ordinary Markdown, YAML Properties, `[[Note]]`, `[[folder/Note#Heading]]`,
`[[Note#^block-id]]`, aliases, headings and tags. Links navigate; immutable
source snapshots and exact revisions support load-bearing claims.

Read the current revision and use `expectedRevision`. For structural changes,
use `wiki.relation_set`, `wiki.reciprocal_link`, `wiki.moc_order`,
`wiki.hierarchy_change`, `wiki.moc_membership`, or `wiki.property_migration`.
Dry-run its `notes.change_set`, inspect and confirm the fingerprint, then reread
targets. Obsidian visibility needs no commit. Never use triage/review/publish
for retirement or reactivation.

For maintenance, `volatility_class` supplies default cadence; cascades stay
advisory. Use `wiki.moc_rebalance` only for an overloaded MOC. Completed tasks
need a knowledge disposition: durable/negative knowledge, a retrospective, or
an explanation of no reuse. Future `review_snoozed_until` defers attention,
not health or exception evidence.

Example: Retire through lifecycle_transition, not triage or publication.
