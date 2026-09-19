---
id: evolution-operations-execution
kind: execution-record
description: CLI event, evaluation and direct-review implementation checklist.
keywords: [CLI, HumanGrad, observations, next-use]
use_when: Resuming the operational connection implementation.
parent: index.md
previous: runtime-usage.md
next: validation.md
---
# Operational connection

Baseline: main d58d8ceee. Existing unrelated research files stay untouched.
Goal: real request observations and direct user review; not more callback scaffolding.
No new accounts, certificates, permission grants, models or transcript collection.

## Checklist

- [x] CLI configuration and code-owned evaluation profiles.
- [x] Authenticated task binding, actual search/read observations, MCP/REST parity.
- [x] One-use loopback direct-review UI using existing authentication.
- [x] Evaluation provenance, scope and alternating paired trials.
- [x] Revocation, interruption, replay and response-budget tests.
- [ ] Build, frozen full regression once, security and staging review.
- [ ] Backup-preserving NAS deployment, live checks, existing-branch fork push.
- [ ] Actual next-session use and effect (cannot be manufactured by ID changes).

## Measurement contract

Search server latency, returned context volume and whole-task tokens are distinct.
Unknown model usage remains unknown; automatic model evaluation stays off.
Static expression checks cannot certify improved model behavior.
Applied, delivered, used and effect-verified are separate observations.
Manual confirmation must be performed by the user, never by the agent.
Next-session evidence requires an actual later session, not a transport reconnect.
Prior inventory: metadata 186/1610 (11.55%); active 0/1610 (0.00%).
These inventory counts were not refreshed in this execution.
Post-freeze delivery evidence: `docs/research/2026-09-20-evolution-operations.md`.
The retrieval profile remains diagnostic; full semantic evidence/model-cost evaluation is pending.
Public static/regression cases are not ten independent agent behavior tasks or private holdout.
