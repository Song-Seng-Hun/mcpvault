---
id: skill-containment
description: Confirmed-risk deletion policy and immediate unreviewed-library containment.
keywords: [skill, quarantine, host policy, 미검증, 격리]
use_when: Operating the NAS skill library after the user's conservative decision.
previous: 2026-09-15-skill-audit-final-results.md
next: 2026-09-15-skill-containment-results.md
---
# Skill containment implementation plan

Goal: delete only confirmed dangerous bundles; block unreviewed use without deletion.
User selected this policy over deleting every incomplete or suspicious result.
Architecture: host-only quarantine at the common PathFilter, before indexes/readers.
Stack: TypeScript, existing MCP/REST dispatch, Vitest, bounded local audit receipts.
Execution: solo in the existing branch; no new agents, PRs, or upstream changes.

## Current evidence

The 1,610 bounded scans are not whole-bundle semantic approvals.
No bundle currently has a verified approval under the new operating policy.
FAIL includes documented false positives; INCOMPLETE is not confirmed danger.
No automatic conversion of NO_FINDINGS or old approval prose into permission.

## Tasks

- [x] Add failing quarantine tests in src/skill-quarantine.test.ts.
- [x] Add MCP/REST tests in src/skill-quarantine-mcp.test.ts.
- [x] Extend PathFilter configuration with a host-only quarantineSkills boolean.
- [x] Wrap the configured filter in createServer; preserve other restrictions.
- [x] Add explicit --quarantine-skills CLI parsing and server wiring.
- [x] Deny the entire Community/Skills subtree, including new and changed files.
- [x] Keep unrelated documents available and original skill bytes unchanged in tests.
- [x] Recheck critical findings; record exact confirmed-risk deletion targets only.
- [x] Run target tests, build, full safe regression, and solo/staged review.
- [x] Preserve prior runtime and activate quarantine in the existing NAS service.
- [x] Verify live denial, ordinary reads, unchanged reviewed sources and host review access.
- Delivery: commit matching dist, push the existing user-fork branch, verify remote HEAD.

## Limits and follow-up boundary

This initial containment has no allow-list bypass or automatic approval endpoint.
All NAS skill bundles remain blocked until a separately verified release is admitted.
Host review reads preserved originals as data; no target execution or dependencies.
Blocked means unavailable through the configured service, not physically removed.
Other agents' retained context, direct SMB/Obsidian access and separately installed
skills are outside this service boundary; do not claim those are disabled.
Permanent deletion requires current exact paths/revisions and recorded dangerous
effects, not a risk score. Do not delete backups, licenses or unrelated copies.
No absolute safety guarantee or new OS sandbox is claimed.
