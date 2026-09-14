---
id: skill-security-hardening-20260915
description: Two-skill hardening scope, verification and host deployment record.
keywords: [skill audit, prompt injection, fail closed, security, 스킬 감사]
use_when: Reviewing or continuing the two-skill hardening delivery.
previous: ../agent-rules/code.md
next: ../../skills/skill-security-auditor/SKILL.md
---
# Skill security hardening

## Scope and constraints

- Strengthen only skill-security-auditor and prompt-injection-defense.
- No other agents, automatic activation, full-library rewriting or target execution.
- Preserve original two-skill inventory, licenses and exact bytes in host backups.
- Keep source content, host snapshots and legacy rules out of public Git.
- New independent host code and skill profiles belong in this fork.
- Rules are inspection data; no pattern or receipt grants permissions.

## Decisions

- Fail closed on invalid rules, unreadable files, links and incomplete coverage.
- Inspect all bounded files, including docs, tests, hooks and dependencies.
- Run regex work in a bounded worker; disclose lack of OS-level sandbox guarantees.
- Suppress raw snippets/paths; report opaque file IDs and typed findings.
- Retain legacy rules by pinned SHA256; no in-audit rule mutation.
- New async API requires await. NO_FINDINGS replaces misleading PASS.
- Separate scan completeness, findings, receipt freshness and execution approval.
- Preserve Korean names; remove immunity, AST and blanket-ASCII claims.

## Checklist

- [x] Prior audit reproduced false passes, credential echo and regex timeout.
- [x] Initial 25 real-filesystem/worker regressions and format checks passed.
- [x] Final 27 regressions include binary decoding and concurrent-worker rejection.
- [x] Both skills passed the skill-creator format validator.
- [x] Build passed; runtime dist unchanged by this standalone host-tool change.
- [x] Full legacy rules: benign baseline and adversarial timeout checked.
- [x] Snapshot prepared; revision/hash guards precede NAS replacement.
- [x] Frozen final2 regression: 503 files; 6,949 passed, 4 skipped, zero failures.
- [x] NAS: 12 files applied and reread; second run changed zero files.
- [x] Live MCP reads: auditor 5.0.0 and injection defense 3.0.0 confirmed.
- [x] Staged paths/content reviewed; runtime dist and unrelated files unchanged.

No independent model-behavior evaluation was run; user requested solo work.
Full run final1 is superseded: source changed during review; never reuse its receipts.
The auditor's own pattern definitions produce review findings; no self-exemption.
Do not turn those findings into a claim that the reviewed engine is malicious.
Recovery: host-only `.mcpvault/skill-security-hardening-20260915-b`; originals retained.
Delivery commit is the Git revision containing this record; verify origin/main separately.
