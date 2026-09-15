---
id: skill-audit-final-results
description: Verification, actual scan and delivery status for auditor version 8.
keywords: [skill audit, verification, scan results, 검증]
use_when: Checking what the final research batch actually validated.
previous: 2026-09-15-skill-audit-final-batch.md
next: 2026-09-15-skill-audit-final-batch.md
---
# Verification checklist

- [x] Fixed counterexamples fail on the previous engine.
- [x] First 113 target tests and library runner test pass.
- [x] Final target tests: 114 Node cases; host/chapter validation 2/2.
- [x] Build; matching dist has no content changes.
- [x] Frozen full regression: 503 files; 6,949 passed, four skipped, zero failures.
- [x] Solo source/security review and staged checks (18 scoped files).
- [x] Actual NAS library scan and selected finding interpretation.
- [x] NAS deployment: 12 changed files; all 22 expected files re-read and verified.
- [x] Live MCP reads: auditor 8.0.0; defense 3.3.0; separate post-change receipts.
Git identity is the containing commit; fork remote equality is checked after push.

## Unverified boundaries

Model behavior, general dependency closure, AST/data flow, destination ownership,
cross-skill runtime effects and native sandbox enforcement remain unverified.
No scanner result authorizes target execution or proves absence of malicious behavior.

## Actual scan

All 1,610 pre-deployment bundles attempted with stable enumeration and engine basis.
866 NO_FINDINGS; 64 WARN; 18 FAIL; 662 INCOMPLETE; zero ERROR.
Nine worker timeouts preserved prior findings in all nine cases.
These states are static results, not malicious/benign labels.
Private receipts and selected review: `.mcpvault/skill-security-library-v8-final-20260915`.
Eight source-matched interpretations distinguish examples from requested effects.
One additional key-pattern review exposed no values and performed no network test.
Scanner made no target edits; only the two owned security bundles are deployable.
Stable directory enumeration is not proof of whole-library byte immutability.

## Regression execution

Memory guard stopped before batch 24 at 1.93 GiB free, after 460 accepted files.
No failed tests preceded that stop; the same frozen-basis run resumed after recovery.
Interrupted work is excluded from accepted coverage; no guard was weakened.
Run: skill-security-v8-final1; accepted coverage revalidated against current source.
Basis: `78721bc03bd7d254391a73bef78680c3275354a160b3348586ebf95eb60e0ffa`.
Backup/deployment: `.mcpvault/skill-security-final-v8-20260915`; no automatic rollback.
Post-deployment auditor remains INCOMPLETE; defense remains WARN. Neither is exempt.
Bulk counts stay unchanged; only those two revisions have superseding receipts.
