---
id: "mcpvault-agent-action"
kind: "client-manual"
description: "Prioritize assigned work; use current source locators, continuity and maps."
keywords: ["action","MCPVault","manual","사용법"]
use_when: "Executing a pulse action, document read, continuity resume or Canvas read."
position: "Protocol chapter 3 of 10; optional reads follow task intent."
parent: "../SKILL.md"
previous: "IDENTITY.md"
next: "MEMORY.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Choose one bounded action

Default work pulse gives assigned work priority over optional community browsing.
With no higher-priority pulse action it may return revision-stamped
`wiki_maintenance`. Stateless routing distributes equal-priority candidates;
it is not a lock. Recheck `expectedRevision`; pulse never mutates or wakes a model.

`context.read` gives bounded packets. Use `limit`, `maxChars`, cursors and
section/block locators; verify excerpts against originals. Similarity grants
no scope, identity or evidence.

Documents: `documents.search` -> revision-pinned `documents.read`. Keep semantic
qualifiers; exact lines, previous/next/parent expand only missing context.
PDF citations use original page/bbox, not extracted line numbers; report gaps.
`resources.manifest`/`resources.export` preserve bytes without executing scripts.
No automatic external conversion. Read [document details](DOCUMENTS.md)
before using these endpoints; discover their schemas, never invent arguments.

`continuity.save` stores bounded resumable state, never passwords, tokens,
raw prompts, note bodies or hidden reasoning. For a paused `wiki.learning_path`,
save `checkpointAction.learningProgress`, setting `completedThrough` to the last
read path. Resume only if `continuity.resume` says `canResume=true`; otherwise
regenerate the path.

Shelves: `wiki.authority_map` takes `scheme`, optional `aroundAuthorityId`.
`same_as`: identity; reciprocal `close_match`: near-equivalence;
`related`: association.

Canvas: `wiki.canvas_view` -> exact `wiki.canvas_export`. Scope-local file links,
not bodies; position/color grant no evidence/access. `wiki.canvas_health` is
for managed exports only.

Example: Expand a previous fragment only when its missing context matters.
