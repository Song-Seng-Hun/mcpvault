---
id: skill-passport-contract
description: Ownership, search examples and potential-impact semantics for skill passports.
keywords: [descriptor, provenance, usage, worst case, 도구예시]
use_when: Authoring or interpreting a skill passport.
previous: 2026-09-15-skill-passports.md
next: 2026-09-15-skill-passports.md
---
# Passport contract

Use metadata.mcpvault in an imported SKILL.md or skill_descriptor in a Vault projection.
Host import may supply the same declaration explicitly. No declaration grants permission.
Existing documents without declarations remain readable under existing access rules.

## Declaration

Version 1; kind procedure/tool/hybrid/unknown; hierarchical domains and bilingual keywords.
Purpose, useWhen, avoidWhen, effects, connections and positive/negative usage examples.
Examples contain a user query, stable action identifier and expected outcome.
Tool/hybrid declarations need an example; missing examples are a review gap, not an executor.
Connections distinguish path/program/API/URI/hook/MCP/package/process/environment.
Only public logical targets belong in declarations; never tokens or host-private paths.
Requested capabilities, host grants and observed actions must never be conflated.

## Potential impact

Separate domain sensitivity, policy, legal, assets, accounts, data and system effects.
Describe a concrete worst-case scenario, affected scope and required assumptions.
Declared financial transactions can have critical asset impact even if implementation is benign.
Domain labels do not establish malice; legal/policy review binds jurisdiction and rule version.
Impact controls cannot erase inherent potential; unknown residual risk remains unknown.
No averaged safety score, automatic approval or automatic widening of permissions.

## Usage

Resolver delivery is not application, receipt acknowledgement or successful execution.
Accepted experience records are reported applications, not host-observed external execution.
Process-local observations are actor/version scoped, bounded and reset on restart.
Optional opaque task IDs group caller-reported applications, not verified task identity.
Retries count once; do not mix accounts or publish other actors' co-use statistics.
No observations means unknown coverage, not a dead skill; no automatic deletion.
Co-use suggests review only; permissions/meaning/license compatibility precede merging.

## Delivery

skill.resolve keeps its old procedure response by default.
Metadata sections disclose summary, description/examples, impact, connections or usage.
Every read rechecks current source/access; source-derived declarations identify version drift.
Small budgets return partial and an exact larger read, never a truncated JSON object.
The NAS quarantine stays enforced for metadata too; no new inspection bypass endpoint.
