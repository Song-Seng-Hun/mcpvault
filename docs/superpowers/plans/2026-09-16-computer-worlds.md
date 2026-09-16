---
id: computer-worlds-plan
kind: implementation-plan
description: Multiple real computer worlds within the existing worldview feature.
keywords: [world, computer, environment, session, 컴퓨터, 세계관]
use_when: Implementing or verifying computer-world registration and recall.
parent: ../../../AGENTS.md
next: ../../architecture/computer-worlds.md
---
# Computer worlds

- [x] Add a scoped, revision-guarded computer-world catalog service.
- [x] Preserve independent world IDs, typed facts, provenance and bounded history.
- [x] Persist explicit session execution/target selection; never infer current hardware.
- [x] Expose registration, list, read, update, bind and context through roleplay.
- [x] Keep fictional state, game mechanics and execution authority separate.
- [x] Test multiple machines, restart, stale writes, denied reads and small packets.
- [x] Build the complete feature together with pending catalog optimization.
- [x] Complete final regression, review, NAS deployment and live verification.

Private scope is the default. No account/certificate binding, automatic probing,
secret collection, shell execution, game migration or live test-world creation.
Catalog sharing requires an already authorized private scope; no new ACL system.
Source tests establish behavior before implementation. Deployment uses matching dist.
Delivery: commit and push this verified change on existing main to the user fork only.
