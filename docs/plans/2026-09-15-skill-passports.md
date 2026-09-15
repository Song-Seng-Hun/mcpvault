---
id: skill-passport-plan
description: Declarative skill discovery, worst-case impact and scoped usage evidence.
keywords: [skill, metadata, potential impact, examples, 잠재위험]
use_when: Implementing or reviewing skill metadata without granting execution rights.
previous: 2026-09-15-skill-containment-results.md
next: 2026-09-15-skill-passports-contract.md
---
# Skill passports implementation plan

Goal: useful searchable skill descriptions plus explicit worst-case impact boundaries.
Architecture: declarations remain untrusted; host observations never become permissions.
Stack: existing TypeScript import, skill.resolve, skill.experience and Vitest services.
Execution: executing-plans, inline TDD; existing main, no agents or new runtime tools.

## Implementation and verification

- [x] RED: projectSkill exposes a bounded descriptor and searchable tool examples.
- [x] Implement src/skill-descriptor.ts; reject authority fields and secret-bearing targets.
- [x] Preserve legacy import behavior when no descriptor is supplied.
- [x] RED: benign payment capability retains critical potential impact, not malware status.
- [x] Implement src/skill-impact.ts with independent impact axes and explicit assumptions.
- [x] RED: successful resolution differs from reported application and proven execution.
- [x] Implement src/skill-usage.ts: bounded process-local, account/version-scoped receipts.
- [x] Deduplicate accepted experience retries; optional opaque task IDs group reported use.
- [x] Never retire quarantined/unobserved/rare skills from zero counts.
- [x] RED: metadata reads respect quarantine, current access, response budgets and drift.
- [x] Extend skill.resolve with metadata sections; no new fixed MCP tool or write bypass.
- [x] Wire source declarations and usage into src/skill-evolution.ts; keep business logic separate.
- [x] Add metadata/exemplar import in src/skill-library.ts; no source execution or auto-import.
- [x] Document fields/examples in chapters <=50 lines with previous/next links.
- [x] Run target tests, build, full test:safe, solo security review and check:staged.
- [x] Deploy the identical build with quarantine retained; verify denied skill and normal reads.
- Git delivery gate: commit matching dist; verify main/fork SHA in the final delivery receipt.

## Deliberate boundaries

Potential impact means worst credible effects of declared capabilities, not attack probability.
Missing declarations/review coverage remain unknown, never low risk or approved.
Examples are search/reference data, not commands, registered tools or authorization.
No new hook, MCP server, network service, credential access or imported-code execution.
Process observations cover this resolver only; restart resets the explicit observation window.
Existing shareable experience writes remain caller reports; execution proof stays unknown.
No private telemetry persists or exports without a separate host storage policy.
No automatic merge, deletion, bulk body rewrite or quarantine release.
Metadata completion and skill safety approval are separate outcomes.
