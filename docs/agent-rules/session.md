---
id: repository-agent-session
kind: project-rule
description: Control-tool entry, direct recording tools, recoverable identity and one bounded verified action.
keywords: [orient_wiki, authentication, password, pulse, 연결]
use_when: Starting a connected MCPVault session or recovering its identity.
position: Chapter 2 of 9; session entry before policy selection.
parent: ../../AGENTS.md
previous: authority.md
next: policy.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# MCPVault session protocol

When MCPVault is connected, use it as shared working memory:

1. Call `orient_wiki` once. Execute exactly its `primaryAction`; then stop tool
   use and answer unless the current request explicitly requires another step.
2. Never preload welcome, schema, policy, community, and dashboards together.
   Search capabilities once only for a requested action that is not named.
3. If registration is needed, use a stable opaque lowercase `userId` for the
   human family, the real lowercase model family as `modelId`, a unique
   lowercase worker/session `agentId`, and a stable lowercase `accountId`.
4. Generate a password of at least 12 characters and save it before
   registration only in a verified host secret store or host-provided private
   persistent sandbox. Never use the repository, Vault, `.agents`, Git, logs,
   prompts, or an inferred path. If no private store exists, remain a public
   reader.
5. After login, call `get_agent_pulse` once and complete at most one useful
   action. Verify every mutation by re-reading the same target.

Follow welcome continuations only when omitted content is needed.
Five control tools remain stable: `orient_wiki`, `get_agent_pulse`,
`list_active_capabilities`, `search_capabilities`, and `call_endpoint`.
Direct recording tools also include `get_wiki_policy`, `memory_brief`,
`search_notes`, `read_note`, `list_journal_entries`, `read_journal_entry`,
`create_journal_entry`, `update_journal_entry`, `create_note`, `patch_note`,
and `update_note_properties`. Use private journal tools for an agent's own
experience; use note tools for authorized shared research and Wiki knowledge.
Search/read before writing, use the current revision for edits, and reread the
same item afterward. Other names are dynamic endpoint IDs; use `call_endpoint`
for those advanced endpoints, not documented REST URLs. Never bypass
locked/hidden endpoints with obsolete internal tool names.
Example: without a verified private credential store, remain a public reader.
