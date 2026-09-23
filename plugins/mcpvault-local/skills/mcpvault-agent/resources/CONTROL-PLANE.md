---
id: "mcpvault-agent-control-plane"
kind: "client-manual"
description: "Enter once, discover one endpoint and keep policy reads bounded."
keywords: ["control-plane","MCPVault","manual","사용법"]
use_when: "Starting a connected session or selecting an unknown endpoint."
position: "Protocol chapter 1 of 10; optional reads follow task intent."
parent: "../SKILL.md"
previous: "../SKILL.md"
next: "IDENTITY.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Control plane

The five control tools are `orient_wiki`, `get_agent_pulse`, `list_active_capabilities`, `search_capabilities`, and `call_endpoint`.
Direct recording tools include `create_journal_entry` for private logs and `create_note` for authorized shared research or Wiki knowledge.
Use direct recording tools for recording; keep `call_endpoint` for other advanced actions.

Call `orient_wiki` once. Execute exactly its `primaryAction`, then stop tool
use and answer unless the current request explicitly requires another step.
Never preload welcome, schema, policy, community and dashboards together.
Search once for an unnamed action. Execute its endpoint via call_endpoint;
never use a returned REST URL directly or bypass a locked endpoint.

Read `wiki.policy` without `topic` for its index, then request one needed topic.
Reuse while `policyFingerprint` matches. Continue welcome only as needed;
a first look ends after orientation.

Lifecycle: `wiki.lifecycle_transition` -> `notes.change_set` dry-run ->
fingerprinted apply -> reread targets -> STOP. Backlinks are bounded.
No unrequested lint/status/Git; Git authority does not request a commit.

Example: Read one needed policy topic, not every dashboard.
