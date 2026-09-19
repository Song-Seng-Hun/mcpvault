---
id: evolution-operations-delivery-20260920
kind: delivery-report
description: Operational CLI, actual request receipts and direct user-review delivery evidence.
keywords: [evolution, CLI, HumanGrad, real-use, 운영]
use_when: Verifying what shipped versus applied or proved effective.
parent: ../architecture/evolution/index.md
previous: 2026-09-19-evolution-runtime.md
next: ../architecture/evolution/operations-usage.md
---
# Operational evolution connection

Baseline: main `d58d8ceee`; existing account/authentication; no new grants or certificates.
Implementation: private CLI config, code-owned evaluation, authenticated request wrapper,
revision-pinned task receipts, bounded observations, loopback direct-review surface.
Frozen basis: `a779fb59bb16d4f1bc5424e761906ff70a9489bc6c9759588a3c2b91e3378df7`.

## Verification

- Targets: 17 files, 82 tests passed, including actual auth/MCP/REST/search integration.
- Build, architecture contract and staged-path/whitespace checks passed.
- Full regression: 541 files; 7,169 passed, 4 skipped, 0 failed; 42.7 minutes, one frozen run.
- Solo review: checked auth boundaries, actual dispatch, cancellation, budget and replay.
- NAS deployment verified; original, world and economy bytes preserved; rollback retained.
- Live: 13 observed requests, existing non-admin login/logout, anonymous denial, five tools.
- Review UI: HTTP 200, no-store/CSP, no external resources; human login/confirmation pending.
- Publication target: existing main on the confirmed user fork; no PR or package release.

## Evidence limits

Expression profile checks exact setting conformance, not improved model behavior.
Its public cases repeat configuration checks; they are not ten independent behavior tests.
Revision/card/budget checks do not establish semantic evidence preservation.
Search-server time is not whole-task time; model token usage is unavailable.
Thus retrieval adoption remains diagnostic and automatic model work remains OFF.
Direct-review UI records a user assertion, not an independent host-captured response.
Response excerpts are memory-only; persisted records retain hashes, not transcripts.
Client session names remain agent reports, never proof of a separate host session.
Live paired exact-path trial (n=3 per budget): both search results 352 chars; source revision retained.
Including identical follow-up reads and MCP envelope: 2,592 chars/pair for both, saving 0%.
Search-server medians: 4,000 budget 263.86ms; 2,000 budget 266.43ms. No latency win claimed.
Observation/storage transport adds cost; measured client calls were approximately 0.93–1.01s.

## Outcome accounting

Deployed routes: 2/2; live observations verified; the user has not accessed the review account.
Applied changes: 0. Actual next-session use: 0. Verified effects: 0.
Synthetic task IDs and simulated browser confirmations do not increase those counts.
The existing account is automation-owned; user-facing login must be resolved without new grants.
Separate inventory, not recounted: metadata 186/1610 (11.55%); active 0/1610 (0.00%).
