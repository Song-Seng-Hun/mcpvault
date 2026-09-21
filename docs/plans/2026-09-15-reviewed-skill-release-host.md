---
id: reviewed-skill-host-gates
description: Reviewed-copy admission and certificate-optional authenticated reads; historical evidence below.
keywords: [host admission, mTLS, rollback, reviewed skills, 운영 검증]
use_when: Resuming actual host provisioning, operator verification or release deployment.
previous: 2026-09-15-reviewed-skill-release-canary.md
next: 2026-09-15-reviewed-skill-release-delivery-fences.md
---
# Host release gates

No live admission, deployment, commit or push yet; Community/Skills quarantine remains enabled.

## Writer and recovery

`skill-release-admission` accepts a trusted host authorization callback, never MCP flags.
One exclusive writer; unknown lock or corrupt receipt requires review, not reset.
Hash blobs precede registry publication; exact expected revision prevents overwrite.
Prepared receipts resume by re-verifying applied bytes; completed IDs cannot resurrect deletion.
Old registry bytes are retained by hash; final authorization and receipt races are rejected.
Ten writer tests passed; directory-junction test also asserts actual replacement occurred.
Tests use real files but mocked Windows ACL observations, not a production approval.
## Reader integration

`skill.resolve view=metadata` returns approved conditions and registered read actions.
No private evidence, raw source or host path is included; every resource still gets checked.
Absent descriptors remain unknown; registered derivative descriptors now have fenced delivery.
Common retrieval/search integration and actual usage telemetry remain pending.
No `wiki.context_route` implementation was found in this baseline; do not assume it exists.

`--reviewed-skills-config` needs quarantine plus explicit skill-evolution selection.
Private v1 config keeps vaultPath, hostPath, ownerPolicyPath, bindingsPath and mTLS listener.
v2 uses version=2, authorization=account, vaultPath, hostPath and ownerPolicyPath only.
v2 reuses normal login; no certificate, NAS registration, binding file or extra listener.
v2 owner grants target `authenticated-skill-read`: a read consent scope, not runtime attestation.
Owner policy accepts only skill-evolution read/discover and Community/Skills prefixes.
Conflicting owner config fails; public HTTP remains unchanged; no automatic MCP registration.
Changed config/TLS files invalidate the bridge until restart; owner/binding changes refresh.
CLI never creates a certificate, account, grant, approval or directory.

## Historical operational evidence (2026-09-15)

New `C:\Users\meleb\MCPVaultHost\ReviewedSkills` has entries/blobs/receipts directories.
Local/NAS boundary and real private Windows ACL checks passed; no credential was read.
Existing 8788 runtime verified: PID 1948, deployment 20260915-skill-passports-final3.
Old account script pins PID 34068; do not run it or re-register blindly.
Real TLS/private ACL integration passed with fixture principal; actual login remains pending.
Full run reviewed-release-host-20260915-a stopped: createServer architecture hash drift.
Reviewed adapter diff and updated deployment diagram/contract; 18 architecture tests passed.
Run b completed: 522 files, 7,039 passed, 4 skipped; source/build basis preserved.
Subsequent fence fixes require a new full run; no production-read completion claim.
