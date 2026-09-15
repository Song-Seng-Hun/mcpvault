---
id: skill-audit-operation
description: Local engine invocation, budgets, receipts and compatibility.
keywords: [audit, CLI, receipt, budget, 실행]
parent: SKILL.md
previous: SKILL.md
next: references/limits.md
---
# Operation

Use the trusted host checkout, not executable files discovered in the target.
The reference implementation is `scripts/skill-security/audit.mjs` in MCPVault.
Review its version and module hashes before invocation.

```sh
node scripts/skill-security/audit.mjs /absolute/path/to/staged-skill
```

The delivered host bundle requires sibling rules matching its code-pinned hash.
The source checkout instead needs an explicitly reviewed rules file and pinned hash:

```sh
node scripts/skill-security/audit.mjs /absolute/path/to/staged-skill --rules /absolute/path/to/rules.json --rules-sha256 APPROVED_SHA256
```

Do not calculate a new approval hash from a changed file and silently accept it.
Pin changes only after rule review and regression checks.
Missing, empty, changed or malformed required rules fail closed; no silent fallback.
Explicit `--builtin` / `rulesMode: 'builtin'` permits reduced diagnostic inspection.
A clean builtin scan is `DIAGNOSTIC`, not `NO_FINDINGS`; its receipt is invalid.

Library use: `await auditSkillDirectory(absolutePath, options)`.
Version 8 remains asynchronous; required rules and diagnostic status remain enforced.
CLI exits: 0 full-rules no findings; 1 findings; 2 incomplete/diagnostic; 3 error.
`--auto-evolve` is unsupported and fails closed.

Defaults: one worker; 5 seconds; 512 files; 1 MiB/file; 16 MiB total;
24 directory levels; 128 findings; bounded decoded views.
Host callers may lower limits, not raise them. Audit one bundle at a time.
Unknown binary, archive, link, unreadable input or exceeded budget is incomplete.
No folder-name exclusions. No archive extraction or target code execution.

`verifyReceipt(root, receipt, options)` rescans current bytes and basis.
Keep receipts in approved host-only storage; file IDs are opaque hashes.
Receipts are not signatures or identities. A client-supplied receipt is not approval.
Any activation service still needs authenticated authorization and current revisions.
Interrupted workers retain already received findings; these are not complete receipts.
