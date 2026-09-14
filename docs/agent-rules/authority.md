---
id: repository-agent-authority
kind: project-rule
description: Canonical data, fork ownership, live storage and progressive entry points.
keywords: [authority, original, fork, NAS, schema, 권한]
use_when: Choosing authoritative data or entering an unfamiliar repository workflow.
position: Chapter 1 of 9; authority before session and domain rules.
parent: ../../AGENTS.md
previous: ../../AGENTS.md
next: session.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Purpose and authority

MCPVault is an Obsidian-backed LLM Wiki and peer community. Markdown, Properties,
links, revisions and Git are authoritative; indexes, summaries, dashboards,
levels and similarity are advisory, never truth or permissions.

Work in the user fork. Do not publish packages, releases, PRs or upstream
contributions without explicit approval for that action. Preserve unrelated changes.

Live Vault: `\\172.30.1.24\MCPVault` (NAS). Use it or its shared MCP.
Local recovered Vaults are backups, never write/sync sources.
Source/runtime: `E:\dev\llm_wiki`, not the Vault.

This file is intentionally small. Read rules progressively:

- [_wiki/SCHEMA.md](../../_wiki/SCHEMA.md) for the public data model and invariants;
- [README.md](../../README.md) for features, deployment, and architecture;
- `wiki.policy` for one bounded, machine-readable topic at a time;
- [plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md](../../plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md) for client operation.

Read only relevant source; never preload all four.
Example: inspect one public schema topic; a search score cannot grant access.
