---
id: evolution-runtime-usage
kind: host-manual
description: Connect reviewed code-owned checks and existing authenticated host sessions.
keywords: [createServer, evolutionRuntime, metering, host, TaskGrad]
use_when: Integrating an already approved host; not granting new access.
parent: index.md
previous: runtime-contract.md
next: validation.md
---
# Existing-session integration

`createServer(vault, { evolutionRuntime: { storage, profiles } })` connects
existing account checks, source revisions, evidence records and the evaluator.
Load `storage` with `loadEvolutionStorage`; do not expose it through MCP.
`profiles` are reviewed code-owned `EvaluationProfile` instances, not JSON scripts.
No automatic model calls or human-message inference occur at startup.
Custom legacy `evolution` options and `evolutionRuntime` cannot be combined.

`getServerRuntime(server).evolutionHost` is in-process only:

- `captureFeedback(token, data, origin, eventId)`: host attests the exact event.
- `deliverContext(token, {taskId, sessionId, taskKind})`: return packet and receipts.
- `verifyUse(token, receipt, checker)`: execute a host check, not client success flags.
- `recordForegroundUsage(token, eventId, tokens)`: verified total input/output usage.
- `runTask(token, context, operation)`: pin a compatible harness for existing tools.

Example: capture a verified correction; call existing feedback/cycle endpoints;
deliver next-task context; observe actual use; submit its use receipt.
A host must not label an agent paraphrase as a verified human event.
Retained context stays unknown; delivery is not proof of use or understanding.
Operational checks inspect actual outcomes; fixture checks remain synthetic.

## Current boundaries

The concrete connection includes persona, data-only harness and wiki adapters.
World and reviewed-skill adapters retain their existing explicit host integration.
They are not automatically granted owner consent by the new connection.
Automatic application requires native exact-revision rollback support.
Keyword suppression and optional procedure selection are enforced in retrieval.
Direct/graph routing and optional review removal remain unsupported automation.
Task pinning covers harness profiles; general resource pinning remains open.
Automatic opportunities require metering; `explicit: true` is host-only manual use.
An unknown final charge freezes further automatic calls; never replace it with zero.
The bounded budget ledger stops at 1,024 entries rather than discarding history.
No live host message transport, secret holdout or operational improvement is assumed.
