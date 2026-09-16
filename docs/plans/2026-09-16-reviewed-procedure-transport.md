---
id: reviewed-procedure-transport
description: Explicit host-only procedure search opt-in; no live access grant.
keywords: [skills, discovery, transport, mTLS, 검색]
use_when: Reviewing the supplementary skill read transport or its remaining gates.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-batch-review.md
next: 2026-09-15-reviewed-skill-release-operations.md
---
# Procedure discovery transport

The common retrieval service already supports approved procedure cards.
The supplementary HTTP profile previously rejected every search request.
This change connects only procedure discovery, behind a new host opt-in.

## Contract

- Existing configs stay read-only: discovery defaults to false.
- A private, pinned listener config may declare `allowProcedureDiscovery: true`.
- Only `wiki.search` with explicit `resultKind: procedures` is admitted.
- Allowed search fields: query, resultKind, limit, maxChars, accessToken, prettyPrint.
- General note search, URL aliases, mutation and authentication endpoints stay denied.
- Mixed batches are rejected before dispatch when any member is forbidden.
- The channel still requires loopback, TLS and a CA-verified client certificate.
- Current account, source ACL, owner read/discover consent and release checks remain.
- Config changes invalidate the running host bridge; request JSON cannot opt in.
- This flag is not a skill approval, execution permission or new account grant.

Example: an already authorized host may transport a procedure-only `review` query.
Without separately verified authorization, it must not return an approved card.
No production access config, certificate or permission was changed here.
Do not use this document to recreate previously rejected access grants.

## Remaining completion gates

The first-eight registry candidate limitation is unchanged by this transport patch.
Paged/indexed discovery remains required; do not claim a full-catalog fix.
Actual authenticated search/read/use, revocation and reapproval remain unverified.
The production account/host access blocker is separate from these code changes.
No skills were activated, deleted or newly counted as metadata by this patch.
Track test, deployment and fork delivery evidence separately from skill completion.

## Verification

Target tests: 14 passed; TypeScript build passed.
Frozen full regression: 525 files, 7,077 passed, four skipped, zero failures.
NAS deployment preserved canonical bytes; public read and quarantine checks passed.
Authenticated skill activation remains unverified; the new option stays OFF.
