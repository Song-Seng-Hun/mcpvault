---
id: reviewed-skill-metadata-wave24
description: Credential-topic review distinguishes unsafe advice from legitimate authentication.
keywords: [credentials, auth, n8n, TLS, 삭제판정]
use_when: Reviewing these three bundles or deciding whether credential wording warrants removal.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave23.md
next: 2026-09-16-reviewed-skill-metadata-wave25.md
---
# Credential-related review

These are source findings, not deployed corrections or permission to execute examples.
No unnecessary skill-access certificate/secret demand was established in this batch.

## Disposition

- auth-implementation-patterns: repair required; access token in redirect URL.
- Its session renewal, fresh authorization and user-field projection are incomplete.
- Its ownership example includes blanket admin bypass and an async factory mismatch.
- n8n-credentials-and-security-official: repair required; raw signing key as workflow input.
- Its test_workflow no-side-effects assertion has no supplied isolation guarantee.
- Export reassurance and one-off inline-secret exception conflict with safe secret boundaries.
- secrets-management: insufficient procedure; only a short entry, no runner or references.
- TLS handling is its advertised topic, not a demand for a certificate to use the skill.
- No item was activated, rewritten at source or selected for automatic deletion.

## Corroboration and limits

Query-token exposure conflicts with [OAuth security BCP](https://www.rfc-editor.org/info/rfc9700/).
Retained n8n text forbids agent credential creation and accepting chat secrets.
Its API/tool behavior is not verified against an installed n8n environment.
Two official docs paths and two raw paths returned not-found; mirrors were not substituted.
All eight files (40,171 bytes) were main-read and source fingerprints rechecked twice.
Field acceptance and 24 negative evidence controls passed; no behavioral trial ran.
No source scripts, credential operations, workflows or host grants were executed.

## Counts and next action

Metadata: 183 / 1,610 = 11.37%, up three (0.19 percentage points).
Pending: 1,425; fixtures: two. Live activation: zero (0.00%).
Backup-inclusive deletions: zero; final activation-or-deletion outcome: 0.00%.
Private generation: 17b000cd30d7e348d5f17150018d84c3bcc0ae7d811c51e00a54c099790343d3.
All 26 pages reread; repeated generation did not create a duplicate.
Any derivative needs provenance, concrete replacements and separate function/safety tests.
Deletion requires the exact confirmed target/backup list, not keyword or domain matches.
