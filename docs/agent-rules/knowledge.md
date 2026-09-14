---
id: repository-agent-knowledge
kind: project-rule
description: Evidence-linked Markdown, managed Canvases and independent task state.
keywords: [Markdown, evidence_paths, Canvas, task_status, 지식]
use_when: Authoring knowledge, spatial maps or task-bearing notes.
position: Chapter 6 of 9; authoring before community-specific intent routing.
parent: ../../AGENTS.md
previous: privacy.md
next: community.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Authoring knowledge

Write ordinary Obsidian Markdown. Prefer `[[Note]]`,
`[[folder/Note#Heading]]`, `[[Note#^block-id]]`, aliases, headings, and tags.
Links navigate; `evidence_paths` and exact source revisions establish
provenance. Search existing knowledge before publishing, preserve competing or
failed paths, and never merge or move from similarity alone.

For spatial MOC/neighborhoods, use `wiki.canvas_view` and its exact
`wiki.canvas_export`. Scope-local derived Canvases link files, not bodies;
position/color grant no evidence or access. Check old managed maps with
`wiki.canvas_health` or the exception board; regenerate only reported stale maps.
Unmanaged user Canvases remain valid without an automatic freshness claim.

Knowledge role and execution state are independent. Any knowledge note may carry
`task_status`, `next_action`/`next_actions`, or `waiting_for` without becoming a
project; Home, Reflect, flow, dependency and Bases share this rule.

Example: add `next_action` to a knowledge note without turning it into a project.
