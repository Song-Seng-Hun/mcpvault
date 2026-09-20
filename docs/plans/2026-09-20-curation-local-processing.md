---
id: curation-local-processing
kind: execution-record
description: CLI structural processing without pretending a remote model is local.
keywords: [compilation, CLI, verbatim, split, source_family, 원문, 복구]
use_when: Connecting explicitly admitted ordinary-document structural processing.
position: C2 runtime connection after physical split; not full-plan completion.
parent: 2026-09-20-curation.md
previous: 2026-09-20-curation-split.md
next: 2026-09-20-curation-operation.md
---
# Local structural processing

Baseline: cbd117c00. Release 20260920-curation-local-processing-final is live.
## Contract

- CLI registers `builtin-verbatim-v1`, supporting `index` only.
- Exact document grant selects `processing: verbatim`; omission preserves legacy behavior.
- Host runtime allowlist must explicitly contain `builtin-verbatim-v1`.
- Account, current document restrictions, resolved classification and path grants still apply.
- No remote-model attestation, generation, embedding, vision or external conversion.
- Preparation preserves source bytes; original/plan reads are available.
- Generated candidate submission/read is rejected; `generationAllowed` is false.
- `source_only` remains read/preservation-only, even with a publication grant.
- Physical writes additionally need `publication: verbatim`, synthesis-allowed source policy,
  current write permission, preview fingerprint and pinned source/journal revisions.
- Configuration is data, not a script/module loader or new account permission.
- Changes to processing grants invalidate previous preservation authority.
- Existing source-family/work identity survives physical chapter creation.
- Invalid identity metadata requires review instead of inventing another identity.
- Durable last-attempt completion can reconcile without replaying document writes.
- Withdrawal has a separate three-attempt budget; it cannot reopen publication.

## Verification boundary

- Compiled CLI test uses a dedicated synthetic Vault and private host directory.
- It covers authenticated preserve/apply, a new server process, historical read,
  withdrawal, anonymous denial, read-only denial and current permission revocation.
- Temporary test files are removed; no synthetic data is added to the live NAS.
- Tests do not establish next-session user benefit or automatic curation eligibility.
- This does not connect generated single-output compilation or override quarantine.
- Existing live policy/managed receipts are still prerequisites for real curation.
- No account, certificate binding, access expansion or live content change.
## Delivery

- Build/full regression passed: 560 files; 7,352 passed, 4 skipped, 0 failed; basis ea12dc75.
- Existing-account live read/diagnose passed. Host policy remains unconfigured; automatic curation is OFF.
- Actual NAS application / recovery / next-use effect: 0 / 0 / 0.
- Skills: last metadata 186/1610 (11.55%); active 0/1610 (0.00%); not recounted.
