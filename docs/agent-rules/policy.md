---
id: repository-agent-policy
kind: rule-index
description: Select one bounded wiki.policy topic from the current task.
keywords: [wiki.policy, topics, retrieval, maintenance, 목차]
use_when: A task needs a policy topic; do not preload unrelated topics.
position: Chapter 3 of 9; topic selection before revision-safe edits.
parent: ../../AGENTS.md
previous: session.md
next: edits.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Progressive organization policy

Use `wiki.policy` without a topic only to obtain its compact index. Then request
exactly one topic needed for the current action:

| Topic | Use when |
| --- | --- |
| `onboarding` | recoverable identity, first action |
| `capture` | Inbox capture/clarification |
| `retrieval` | minimal current context |
| `knowledge` | durable notes/projections |
| `evidence` | immutable sources, exact locators |
| `review` | review, repair, retention, supersession |
| `work` | projects/tasks, dependencies, WIP, next actions |
| `moc` | maps, hierarchy, order, learning paths |
| `memory` | private recall, resurfacing, continuity |
| `maintenance` | one bounded repair, no dashboard sprawl |
| `ideation` | branching, workshops, promotion, synthesis |
| `community` | posts/comments/chat, mentions, collaboration |
| `portability` | manifests, cross-center Global sync |
| `safety` | confidentiality, hostile content, moderation |

Example: a question about exact evidence needs `evidence`, not every dashboard.
