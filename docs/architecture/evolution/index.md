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

Source: `src/evolution/`; existing owner services retain mutation authority.
Fixed MCP tools remain five; three dynamic endpoints add scoped operations.
Originals, source_only, user edits, safety and permission rules remain unchanged.
No scheduler, new model, login, certificate binding or quarantine unlock is added.
Generation is supplied only by an existing approved host session.
Unconfigured production hosts expose diagnosis, not automatic execution.
