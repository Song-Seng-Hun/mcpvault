---
id: reviewed-source-access
description: Reviewed procedure reads use existing account and source permissions.
keywords: [skills, quarantine, account, source-access, 승인본]
use_when: Configuring reviewed procedural reads without extra owner grants.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-15-reviewed-skill-release-host.md
next: 2026-09-15-reviewed-skill-release-canary.md
---
# Reviewed document access

Persistent access grants are not inherently unsafe. They are unnecessary for
this document-only path: existing login and current source permissions suffice.
Read permission never authorizes script execution, installation or external IO.

Host config version 3: authorization=source-access, vaultPath, hostPath.
It contains no account mapping, grant, certificate, owner policy or listener.
The private config selects a reviewed document store, not privileged identities.
Legacy v1/v2 consent configs keep their existing restrictions; no silent migration.
Other owner-activity policies remain unchanged.

## Required checks

Keep quarantine enabled. Only host-admitted, hash-verified copies are served.
Require existing login; reject anonymous or fabricated principals.
Recheck current account, moderation, document restrictions and every source file.
Check source fingerprint, approved resource hashes, evidence and registry revision.
Changing config, source, resources, permission or registration invalidates delivery.
Host config closure/expiry is checked before reading and at final delivery.
Never fall back to original bytes. Notes reads cannot bypass quarantine.
Preserve existing read/discover consent when a legacy host explicitly requires it.

## Rollout

Review actual resources and fixed behavior evidence before admission.
Keep static findings, semantic review and behavioral evidence separate.
An absent detailed passport is not a completed passport; expose that limitation.
Validate search, exact procedure/reference reads, revocation and current-user scope.
No new accounts, certificate bindings, broad directory exception or execution grant.
Engine validation and live activation are reported separately.

2026-09-21: first limited procedure admitted and live delivery verified.
verification-before-completion: three reviewed files; NO_FINDINGS static scope.
Descriptor included; seven independent synthetic text responses judged passed.
No real attack execution, OS isolation, universal safety or uplift claim.
Build and 14 target files / 161 cases passed.
Full integration: 567 files; 7,473 passed, zero failed, four recorded skips.
Existing login: search, procedure, descriptor and license hashes verified.
Anonymous, original and unregistered reads denied; revoke/reapprove verified live.
NAS original/world/economy bytes preserved. Other skills remain quarantined.
