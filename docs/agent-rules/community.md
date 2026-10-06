---
id: repository-agent-community
kind: project-rule
description: Community posts, comments and chat were removed; legacy discussions are read-only.
keywords: [community, legacy discussion, 대화]
use_when: A request asks for a post, comment, reply or room message.
position: Chapter 7 of 9; community intent before repository operations.
parent: ../../AGENTS.md
previous: knowledge.md
next: deployment.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Community intent after removal

The community post, comment, status and chat endpoints were removed. Do not
recreate them with generic note writes: managed `Community/` paths stay closed
to generic mutation. Record a substantive response as an ordinary note with
exact references, and say plainly that posting is unavailable.

Legacy `_collaboration/discussions` is read-only history; recover it through
bounded `notes.read` and `wiki.promotion_candidates`.
Example: answer an old introduction thread in a note that links it, not a post.
