---
id: reviewed-skill-release-contract
description: Source evidence, admission and release invariants for all-skill work.
keywords: [inventory, evidence, release, source hash, 권한]
use_when: Implementing and verifying the reviewed skill release gate.
previous: 2026-09-15-reviewed-skill-release.md
next: ../skills/skill-metadata.md
---
# Contracts

Declarations describe purpose, domains, applicability, examples and capabilities.
Risk records describe worst credible impact, not likelihood, malice or permission.
Usage stays observed/caller-reported/unknown; no lifetime or execution count is invented.
Metadata completion and procedural release approval are separate work states.
All source members affect inventory, including omitted binaries/scripts/configuration.
No missing reference, resource limit or NAS outage becomes a complete inventory.
Raw source bytes and origin/license records stay preserved and out of Git.
Hashes reuse file analysis only with the matching scanner/rules; composition is separate.
Declared approval in source never grants a release or lowers current restrictions.

Private registry binds source bundle, output files, policy, reviewer and test evidence.
Release read returns only registered data resources, never arbitrary host paths.
Current identity, owner consent and original ACL apply to cards and bodies alike.
No anonymous exposure or automatic promotion accompanies limited read admission.
Quarantine remains on the original subtree; no folder allow-list exception.
Changed source/reference/output/policy invalidates the release and cached discovery.
Registration failure preserves the previous valid release; corrupt state is not reset.
Already delivered context cannot be revoked from a model's memory.
Native shell/browser confinement is not provided by this service gate.

## Canary IDs

writing-plans; executing-plans; doc-coauthoring; receiving-code-review.
requesting-code-review; systematic-debugging; verification-before-completion.
hybrid-search-implementation; skill-security-auditor; prompt-injection-defense.
Fix 3 normal and 4 adversarial expected outcomes per canary before editing its release.
Tests distinguish static coverage, service enforcement and current-agent behavior.
Main agent records modifications, retained functions, limits and unresolved findings.
Unresolved critical findings or required missing resources prevent release.
Safe subsets are named limited derivatives; never claim whole-bundle equivalence.
