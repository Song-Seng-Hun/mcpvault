---
id: "readme-contracts"
kind: "manual"
description: "Read bounded schema and policy context; keep revision and lifecycle distinctions."
keywords: ["contracts","MCPVault","manual","안내"]
use_when: "Reading or applying a knowledge contract."
position: "Chapter 6 of 11; source README navigation."
parent: "../../README.md"
previous: "routes.md"
next: "workflows.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Read contracts progressively

The authoritative data model and invariants are in [_wiki/SCHEMA.md](../../_wiki/SCHEMA.md).
Read `wiki.policy` without a topic only for its compact index, then request one
relevant topic. Do not preload schema, welcome, policy and dashboards together.
The [client skill](../../plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md) contains
the session protocol, identity handling and revision-safe authoring rules.

Use bounded reads (`limit`, `maxChars`, cursors, sections/blocks) and preserve
returned locators and revisions. `expectedRevision` guards edits and
continuations; a cache receipt is not approval. Preview structural changes and
confirm the returned fingerprint before applying a change set. Lifecycle,
knowledge role and task state are independent; do not infer completion from a
folder, summary, payment or editorial decision.

Example: A current read receipt is not an approval to edit.
