---
id: skill-containment-results
description: Verified containment state, deletion decisions and remaining safety limits.
keywords: [skill, quarantine, verification, deletion, 검증]
use_when: Checking what the conservative skill policy actually enforces.
previous: 2026-09-15-skill-containment.md
next: 2026-09-15-skill-containment.md
---
# Containment evidence

- [x] Three initial regressions fail before implementation.
- [x] Dot-segment alias regression reproduced, then corrected before name folding.
- [x] Target verification: 81 passing tests across five files; build passes.
- [x] Critical files for all 18 FAIL bundles match the earlier scan hashes.
- [x] Fresh full regression: 505 files; 6,954 passed, 4 skipped, zero failures.
- [x] Solo code/security review, staged-content review and check:staged validation.
- [x] NAS service deployment, live denial and unchanged Welcome revision verified.
- [x] Post-deployment preservation: all 19 reviewed critical hashes still match.

The first full run failed on the changed createServer source hash, not its semantic
architecture checks. The approved wrapper change was reviewed before updating only
that manifest entry; no detector or architecture check was removed or weakened.
Its failed receipts remain separate and are not accepted as current passing evidence.
Pre-deployment scoped wiki.search returned Maximum call stack size exceeded;
that failed baseline is not a passing search or containment result.
Environment exclusions are counted separately: pipe filenames, POSIX permissions
and unavailable Windows file-symlink privileges. Exclusions are not passing tests.
Run receipt: `.mcpvault/test-runs/skill-quarantine-final2`; current source basis verified.
Live notes.read and documents.outline deny the skill; the same scoped search returns [].
The earlier stack failure is retained as a failed baseline, not a general search fix.
Original evidence, roleplay and economy canonical bytes match across deployment.

## Disposition

Critical-span review is not whole-bundle approval or proof of absence of malware.
Inspected signals include prose false positives, package setup and forensic examples.
Confirmed destructive/exfiltrating/authority-hijacking bundle targets: none established.
Permanent deletions: zero. All unreviewed bundles stay blocked through the host service.
Private source-hash evidence: `.mcpvault/skill-containment-20260915`.

## Enforcement limits

Host --quarantine-skills blocks Community/Skills including references and new files.
No document metadata, old audit verdict or passing static score can unlock it.
Explicit MCP reads are also denied; host-only offline review remains possible.
This is containment, not an allow-list approval system or an OS execution sandbox.
Direct NAS/Obsidian access, separately installed skills and already retained context
are not revoked. The previous runtime remains for recovery, not parallel exposure.
No absolute safety guarantee is claimed; reviewed releases require a separate gate.
