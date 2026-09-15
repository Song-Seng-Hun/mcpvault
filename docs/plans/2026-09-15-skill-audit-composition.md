---
id: skill-audit-composition-hardening
description: Bounded composition and coverage hardening after the second research review.
keywords: [skill audit, composition, coverage, refusal, 스킬 감사]
use_when: Implementing or verifying the next host-owned auditor revision.
previous: 2026-09-15-skill-audit-research.md
next: 2026-09-15-skill-audit-composition-verification.md
---
# Scope and fixed boundaries

Baseline: main 1d31be868; preserve unrelated untracked research and legacy rules.
Solo; no target execution, agents, full-library audit, new dependencies or model calls.
Findings are review signals, not maliciousness proofs or execution permissions.

## Work sequence

- [x] Freeze inert cases for decoding, references, composition and opaque resources.
- [x] Run those cases against the existing engine; retain failure evidence.
- [x] Add bounded inspection views and explicit unsupported-reference coverage.
- [x] Inspect decoded capabilities along actual directed paths, not unrelated files.
- [x] Report per-file coverage and distinguish static completion from review readiness.
- [x] Add effect signals and refusal/unknown-review guidance without disabling safeguards.
- [x] Verify each skill's chapters, examples, links and remaining limits.
- [x] Run targets, build, solo security review, then one frozen full regression.
- [x] Inspect staging; back up and deploy only the two approved NAS skills.
- [x] Reread both deployed skills through the live MCP service.
- Final Git identity is the containing commit; confirm the fork's remote main matches.

## Evidence and limits

Prior probes missed named entities, brace escapes, emphasis, computed imports,
Python/HTML/wiki references, three-file paths and decoded capability composition.
These are selected counterexamples, not measured real-world detection rates.
Preserve raw bytes. Unknown formats, exhausted budgets and unresolved resources fail closed.
Bound graph states and hops; explicitly report deeper paths as uninspected.
Do not exempt quotes or negation: annotate review context without suppressing findings.
Do not claim AST analysis, complete dependency closure, runtime action enforcement,
cross-skill safety, semantic paraphrase coverage, or image understanding.
Reviewer refusal, missing output and claimed approval cannot erase static evidence.
Human/model compliance under pressure remains unmeasured; no new model sessions.

## Research basis

Mechanisms independently implemented; no attack package or source code imported.
CompoSkill: https://arxiv.org/abs/2608.16246
Payload-less Skills: https://arxiv.org/abs/2605.14460
SkillCamo: https://arxiv.org/abs/2606.18198
Scan the Skill, Govern the Action: https://arxiv.org/abs/2609.12001
Trail of Bits: https://blog.trailofbits.com/2026/06/03/the-sorry-state-of-skill-distribution/
JFrog: https://research.jfrog.com/post/prompt-injection-vs-scanners/
