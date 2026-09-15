---
id: reviewed-skill-delivery-fences
description: Post-baseline resource-race and read-channel corrections with explicit validation limits.
keywords: [final fence, read-only profile, mTLS, revocation, 전달 경합]
use_when: Verifying the corrected reader before any canary activation or deployment.
previous: 2026-09-15-reviewed-skill-release-host.md
next: 2026-09-15-reviewed-skill-release-operations.md
---
# Delivery corrections

Frozen run b: 522 files; 7,043 tests, 7,039 passed, 4 skipped, no failures.
Basis: c2e598cf4ac39e95ccadb14c298f682c8389bc84a3e17b11227b893cfd580dfc.
Receipt coverage and source/build fingerprint were rechecked before subsequent edits.
This is historical baseline evidence, not a full pass for the corrections below.

## Reference change during final permission refresh

Synthetic probe returned old verified text after an unrequested reference changed.
No altered text was delivered, but changed-copy approval was not invalidated in that gap.
Three new regression cases failed before correction; 18 reader/store tests passed afterward.
The synchronous final host fence now rechecks the manifest and all resource hashes.
Bounds: 33 unique blobs; 1 MiB each; 4 MiB plus 64 KiB manifest total.
Existing path, identity and hardlink guards apply; no unbounded cache or final awaited read.
Real-file tests simulate Windows ACL observations; no claim of atomic NAS/OS isolation.

## Supplementary mTLS channel

The original extra listener reused the general MCP dispatcher without a request filter.
Owner activity consent alone does not restrict every unrelated endpoint of an existing account.
A real-TLS test with a stub dispatcher reproduced unrelated-call admission before the fix.
Host loading now fixes requestProfile=reviewed-skill-read; clients cannot choose it.
Only protocol setup/listing/cancellation and canonical call_endpoint -> skill.resolve pass.
Other tools/endpoints, URL aliases, mixed read/write batches and non-POST dispatch are rejected.
Account login uses the existing channel; no login/register endpoint is opened on this one.
The five tool definitions stay intact; unsupported calls here remain unavailable.
This is a diagnostic resource-read channel, not full approved-skill search integration.
The actual read service still validates current token, original ACL, owner consent and release.
General MCP behavior without this host-only profile is unchanged.

## Current evidence and remaining gates

Combined correction targets: 32 tests in five files passed; build passed afterward.
Broader reader/MCP/host/architecture targets: 114 tests in 19 files passed.
Fresh full regression run c started; do not substitute run b for its result.
Diagram now shows the transport read gate and final resource fence; contract hash updated.
No live host access files, approval, listener, deployment or fork commit were added.
Auto-review denial of access setup remains in force; these fixes do not authorize a retry.
Continue other reviews and metadata; count no draft as a live usable skill.
