---
id: evolution-contract-index
kind: architecture-index
description: Scoped TaskGrad/HumanGrad cycles and actual-delivery verification.
keywords: [evolution, HumanGrad, TaskGrad, feedback, 진화]
use_when: Integrating approved feedback or investigating a stale improvement.
parent: ../../../AGENTS.md
next: host.md
---
# Unified evolution

Observe -> attribute -> candidate -> compare -> apply -> next use -> verify.
Applied does not mean effective. A test fixture is not a live-user result.

| Chapter | Use |
| --- | --- |
| [Host contract](host.md) | Authority, storage, native adapters, session opportunity |
| [Endpoints](endpoints.md) | Record, evaluate, read context, reconcile, withdraw |
| [Validation](validation.md) | Frozen scenarios and separate evidence classes |
| [Runtime use](runtime-usage.md) | Concrete existing-account host connection and limits |
| [Runtime contract](runtime-contract.md) | Receipts, trials, budgets and protected rules |
| [Operational CLI](operations-usage.md) | Actual request receipts and direct user confirmation |
| [Operational execution](operations-execution.md) | Delivery evidence and remaining real-use gates |
| [Execution](execution-2026-09-19.md) | Current implementation and remaining delivery gates |

Source: `src/evolution/`; existing owner services retain mutation authority.
Fixed MCP tools remain five; three dynamic endpoints add scoped operations.
Originals, source_only, user edits, safety and permission rules remain unchanged.
No scheduler, new model, login, certificate binding or quarantine unlock is added.
Generation is supplied only by an existing approved host session.
Unconfigured production hosts expose diagnosis, not automatic execution.
