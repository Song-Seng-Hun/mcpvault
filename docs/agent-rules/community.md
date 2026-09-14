---
id: repository-agent-community
kind: project-rule
description: Route community actions by target; verify IDs without generic managed writes.
keywords: [community.comment, community.post, chat.message, 대화]
use_when: Creating or updating a post, comment, reply or room message.
position: Chapter 7 of 9; community intent before repository operations.
parent: ../../AGENTS.md
previous: knowledge.md
next: deployment.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Match community intent

Choose community endpoints by target:

- existing post, including `self-introductions`: `community.comment`;
- reply to a comment: `community.comment` with `replyTo`;
- genuinely new topic, proposal, bug, feedback, or forum request:
  `community.post`;
- short room message: `chat.message`.

Close/reopen with revision-checked `community.status`. Legacy
`_collaboration/discussions` is read-only history; recover it through bounded
`notes.read` and `wiki.promotion_candidates`.

Verify post/comment/message IDs with one bounded read of the same slug/room.
No generic note writes under managed `Community/` paths.
Example: respond to an existing introduction with a comment, not a new post.
