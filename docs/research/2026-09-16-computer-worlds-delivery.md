---
id: computer-worlds-delivery
kind: verification-report
description: Evidence and limits for private computer-world registration and recall.
keywords: [computer, world, environment, deployment, 컴퓨터, 세계관]
use_when: Checking what was implemented and actually verified.
parent: ../architecture/computer-worlds.md
previous: ../superpowers/plans/2026-09-16-computer-worlds.md
next: ../architecture/computer-worlds.md
---
# Computer-world delivery

Base: c6006eac9158877aa36edcaf7c18ed06dba0e7f3, existing main branch.
Implementation: roleplay.computer, existing roleplay feature and five MCP tools.
Multiple computer IDs, provenance-tagged facts, 12 retained prior snapshots.
Explicit session execution/target selection; private catalog URI survives sessions.
Current-scope ACLs, write capability, owner consent and revisions remain enforced.
No changes to real game journals, user accounts, certificates or permissions.

## Verification

- Initial five behavior tests: missing module then implemented behavior.
- Integration group: 131 tests passed across seven files before review amendments.
- Final focused group: 21 tests passed across three files, including review cases.
- Real local HTTP: five tools, Korean discovery, registration, read and read-only denial.
- Fixtures only: distinct PCs/NAS, restart, revision race, scope denial, corrupt record.
- Fresh build and git diff --check passed before full regression.
- Final regression: 527 files; 7,096 passed, 4 skipped, 0 failed (7,100 total).
- Basis: 8dbe32bdea08f91b89520471aefce47817be338e7119d070b5723f9f3c02050d.
- Live: five tools, Korean discovery, anonymous denial; Welcome hash unchanged.
- Deployed: 20260916-computer-worlds, PID 32236; canonical bytes preserved.

## Read-only review disposition

Luna requested at spawn; reviewer could not independently verify its runtime model.
Credential assignment in arbitrary text: reproduced; reject obvious formats in
titles, fact values and sources, including loaded records. Not complete DLP.
Target constraints delayed by execution facts: reproduced; sort across both roles.
Post-write denial: reproduced; WRITE_UNCONFIRMED reports possibly committed state,
with no unauthorized result or false rollback promise. Existing CAS remains intact.
64-entry request receipt retention: documented; stale exact replay still fails CAS.
First full-run batch: 240/241 passed; two reviewed architecture hashes were missing.
Updated only those hashes; architecture checks and 18 tests passed before fresh run.

## Operational limits

No actual user computer registered by tests. Later sessions must select worlds.
Private model catalog sharing uses existing model-scope access, not a new ACL.
Anonymous connection cannot read/write private worlds; no public fallback.
History and receipts are bounded, not a permanent audit trail.
