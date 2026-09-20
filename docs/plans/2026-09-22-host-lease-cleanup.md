---
id: host-lease-cleanup
kind: execution-record
description: Release an owned host-work lease after request cancellation without permitting further data writes.
keywords: [evolution, lease, cancellation, ownership, recovery, 잠금 해제]
use_when: Diagnosing retained host-work markers or verifying cancelled-request cleanup.
position: Operational follow-up to curation discovery; not whole-plan completion.
parent: 2026-09-20-curation.md
previous: 2026-09-22-curation-discovery-review.md
---
# Cancelled-request cleanup (취소 후 잠금 해제)

Baseline: f8ac1b1e2. Existing runtime, account and storage ownership only.
The live begin probe created a task but no read observations; later begin was blocked.
A marker named the current live server PID. It was not automatically removed.
An isolated cancelled-request reproduction left a marker and blocked reacquisition.
This reproduction alone does not prove every cause of the live failure.

## Scoped correction

- Capture the storage construction context for exact lease release only.
- Record reads/writes and assertHeld still enforce the current request boundary.
- Cancellation cannot authorize another state or record write.
- Never shed a document boundary inherited by storage construction.
- Recheck the private path, file identity, nonce, process and Vault identity on close.
- A replaced marker, including a same-byte replacement, remains untouched.
- Keep close idempotent. Do not add automatic stale-marker stealing.
- No account, certificate, access grant, source protection or model setting changes.

## Recovery boundary

Existing live markers require explicit host inspection, not a client assertion.
Stop only the verified owned runtime before considering its leftover marker.
Require the exact marker fingerprint, a dead PID and unchanged canonical records.
Retain recovery evidence; remove only that execution marker, never config or history.
Unknown owners, changed markers, changed records and live writers stop recovery.

## Verification

Observed failing regression before the fix; cancellation/owner/replacement targets pass.
Shared-service targets: 230 passed / 1 skipped; compiled CLI/lifecycle: 4 passed.
Build passed. Full: 566 files; 7,440 passed / 4 platform skips / 0 failed.
Same-source basis: a0fac22aa8f56e2e07e1115a4562bdc6d32bafe9c1a1c76aedc029d3a724b997.
Release 20260922-host-lease-cleanup deployed; canonical bytes/checkpoints preserved.
The exact dead-writer marker was backed up and removed; host history stayed unchanged.
Live existing-task resume, body read and revision-linked observation completed.
Owned marker absent afterward; recovery backup matches. No new access settings.
Fresh authenticated reread found one completed observation; no read replay or effect claim.
Real NAS curation and next-use effects remain separate and unproven.
Skills last counted: metadata 186/1610 (11.55%); active 0/1610 (0.00%); not recounted.
