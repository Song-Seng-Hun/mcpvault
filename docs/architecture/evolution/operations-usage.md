---
id: evolution-operations-usage
kind: manual
description: Existing-account request tracking and direct project expression confirmation.
keywords: [evolution-config, CLI, HumanGrad, receipt, confirmation, 운영]
use_when: Tracking actual search/read requests or confirming a project-only expression preference.
parent: index.md
previous: runtime-usage.md
next: operations-execution.md
---
# Operational CLI

Start with `--evolution-config <private-host-file>`; invalid explicit config fails startup.
JSON fields: `version: 1`, `enabled: true`, `vaultPath: <canonical vault>`.
Use existing validated private host storage outside the Vault; no executable paths.
This enables records, not accounts, certificates, additional capabilities or models.
Without config, diagnosis remains available; automatic model evaluation stays OFF.

1. Log in through the existing account flow; never put its token in a URL.
2. `evolution.context {op:"begin", requestId, sessionId, taskKind, project}` issues a task.
3. Pass its `task.id` as `evolutionTask`, plus unique `evolutionRequestId`, to search/read.
4. `evolution.context {op:"observations", taskId}` reads server-measured receipts.
5. After a lost reply, inspect receipts. Do not replay an uncertain request.

Client session IDs are reports, not host session proof. Delivery is not retained context.
Read endpoints: wiki search/answer packet, notes read/lines, documents outline/read.
Explicit read-only mode permits reads, but refuses new tracked tasks and confirmations.
REST context reads use GET; `op=begin` uses POST. MCP uses the same execution wrapper.
Receipts store revisions, hashes, result sizes and server time; not raw output or credentials.
Continuation reads remain in the same task with new request IDs; include their costs.

## Direct user confirmation

`evolution.feedback` `op=request_review` accepts a project-only explicit persona correction:
`key:"ordering", value:"outcome_first"`; provide request ID and `expectedRevision:"missing"`.
The user opens `/evolution/review` on the existing loopback MCP HTTP listener and logs in.
The agent must NOT click or submit confirmation. The request expires after ten minutes.
After user confirmation: prepare -> advance -> check -> preview -> apply, with revisions.
On an actual later task/session, begin again and use its returned preference.
`evolution.cycle` `op=request_effect_review` binds the delivery receipt and bounded response
excerpt (`responseSource:"agent_report"`). Only its hash persists; excerpt stays in memory.
The user reviews the actual response, use and result before recording one effect sample.
Withdraw feedback or revert its cycle via existing revision-safe operations.

## Evaluation limits

Expression checks validate settings, not model behavior. Built-in cases are public regression.
Retrieval calls the real service in alternating paired trials, with equal warm-up policy.
It checks bounded cards and revisions, NOT complete semantic evidence or whole-model cost.
Server-only savings remain diagnostic; use explicit 2000/4000 budgets for manual trials.
No new private holdout, actual host token stream or automatic hook attestation is claimed.
