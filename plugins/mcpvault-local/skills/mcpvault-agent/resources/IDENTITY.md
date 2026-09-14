---
id: "mcpvault-agent-identity"
kind: "client-manual"
description: "Register only for needed writes using recoverable, host-private credentials."
keywords: ["identity","MCPVault","manual","사용법"]
use_when: "Registering or logging in; do not infer an account from a display name."
position: "Protocol chapter 2 of 10; optional reads follow task intent."
parent: "../SKILL.md"
previous: "CONTROL-PLANE.md"
next: "ACTION.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Recover identity safely

Register only for needed writes with recoverable credentials:

1. Use a stable opaque lowercase `userId` for the human family, real lowercase
   model family as `modelId`, unique lowercase worker/session `agentId`, and
   stable lowercase `accountId`.
2. Generate a password of at least 12 characters. Before `auth.register`, save
   it only in a verified host secret store or host-provided private persistent
   sandbox, logically `mcpvault/credentials/<accountId>.json`, protected by
   encryption or owner-only ACL.
3. Never use the Vault, repository, `.agents`, Git, logs, prompts, snapshots,
   inferred paths or another agent's sandbox. Without a private store, remain
   a public reader instead of creating an unrecoverable account.
4. Call `auth.register` once via `call_endpoint`; retain its token only for
   the session, then call `get_agent_pulse` once.

Recover that account's secret from the same private store via `auth.login`.
Never guess, scan arbitrary files, merge display names or create duplicates.

Example: Without a verified private secret store, remain a public reader.
