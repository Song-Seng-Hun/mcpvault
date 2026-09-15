---
id: reviewed-skill-release
description: Complete library metadata and reopen only reviewed procedural releases.
keywords: [skills, review, metadata, quarantine, 사용재개]
use_when: Executing the approved all-skill metadata and limited-release goal.
next: 2026-09-15-reviewed-skill-release-contract.md
---
# Reviewed skill release execution

Goal: fill metadata for every in-scope skill; make verified limited releases usable.
Base: main 76d1ae53bfdbbc35e424d33d9f48dc520fd6a375; recheck before delivery.
Original Community/Skills remains quarantined; no scripts/install/hooks execute.
First ten are a canary, not a replacement for the full-library objective.
Low-cost sidecars may draft metadata; main agent verifies evidence and admission.

## Work checklist

- [ ] Refresh complete inventory, durable per-bundle work and input fingerprints.
- [ ] Record all source members, including scripts/config/hidden files, without execution.
- [ ] Fill bounded metadata with source evidence; unknown is not fabricated low risk.
- [ ] Implement private immutable releases and host-owned admission registry.
- [ ] Unify approved discovery/read checks; never fall back to quarantined sources.
- [ ] Bind current account, owner consent, runtime, source/release and policy revisions.
- [ ] Review ten canaries and fix their normal/adversarial cases before deriving releases.
- [ ] Resolve existing operator-account and verified-host read-only connectivity.
- [ ] Test complete read/search/revoke flow; roll out passed canaries individually.
- [ ] Continue remaining metadata/review queue; track explicit coverage gaps separately.
- [ ] Run target/build/frozen full tests, solo review, staging, NAS-backed deployment.
- [ ] Commit matching dist; push only current user-fork main and verify remote SHA.

## Evidence so far

Baseline inspection preceded the implementation recorded in the linked progress chapters.
Existing operator registration receipt names context-ops-20260914; login unverified.
Legacy CLI bridge stays unverified; new optional reviewed reader uses verified mTLS only.
Old scans: 1,610 bundles; 866 clean signals, 64 warnings, 18 failures, 662 incomplete.
Those counts describe historical static scans, not current metadata or safe releases.
Seven pre-existing untracked research documents remain outside this work.

## Completion boundary

Next: [delivery](2026-09-15-reviewed-skill-release-delivery.md), [planning candidate](2026-09-15-reviewed-skill-release-planning-candidate.md), [passport](2026-09-15-reviewed-skill-release-passport-next.md), [next metadata](2026-09-15-reviewed-skill-metadata-next.md).

Report actual metadata coverage, reviewed functions, exclusions and live accessibility.
Prepared files are not usable releases until authenticated host reads succeed.
No blanket safety guarantee, lifecycle deletion, automatic merge or permission growth.
No PR, upstream publication, Telnet or NAS direct-write protection changes.
