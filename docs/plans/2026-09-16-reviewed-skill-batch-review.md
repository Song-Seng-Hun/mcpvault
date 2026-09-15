---
id: reviewed-skill-batch-review
description: Bounded reusable capture and truthful delegated review with main adjudication.
keywords: [batch, Luna, provenance, source-review, 위임검토]
use_when: Continuing library review without cloning fixed three-item verifiers.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave25.md
next: 2026-09-15-reviewed-skill-release-passport-next.md
---
# Reusable review workflow

Private audit helpers changed; production services and access settings did not.
Capture accepts 1-32 named targets, bounded to 1 MiB source and 2 MiB output.
Review packets allow at most 256 files; larger bundles remain explicit exceptions.
Capture is sequential. This is not permission for more than three active reviews.
Existing output fails before NAS collection; no overwrite or automatic reset.
Current source identity is still checked; unavailable NAS is never deletion.

The validator binds the observed worker identity, model and complete file ranges.
It checks descriptor shape and exact source quotes, not semantic truth or safety.
Main adjudication binds the reviewed descriptor hash, all finding IDs and read ranges.
Changed records, forged main reading, missing files and release claims are rejected.
Delegated coverage remains distinct from actual main-agent source coverage.
Historical metadata-completion-1 records remain unchanged.
New metadata-completion-2 records identify delegated source/main-adjudicated review.
Neither version admits a skill, grants execution, or claims behavior-test success.

## Actual batch

Luna read eight files, 49,126 bytes, across three previously pending bundles.
Main checked all findings with source context, reviewed metadata and amended errors.

- deployment-pipeline-design: repair required; absent runner, freeze and health-timeout gaps.
- mcpvault-local-mcpvault-agent: repair required; absent runner, not progressive discovery.
- aws-knowledge-mcp-server: repair required; read-only tools overclaimed as management.
- Setup examples carry installation/MCP effects; remote skills require separate review.

Luna's draft is preserved; main corrections and exact coverage are separately recorded.
All source fingerprints were rechecked twice before sealing. No target code ran.

## Verification and progress

31 pipeline checks passed, including a five-target case and forged-review refusals.
Real generic capture matched prior source bytes; duplicate output was rejected.
These are audit-tool checks, not skill behavior trials or throughput certification.
Metadata: 189 / 1,610 = 11.74%; +3. Main-full-source: 186; delegated/adjudicated: 3.
Pending: 1,419; fixtures: two. Activation: 0%; confirmed deletions: zero; final: 0%.
All 26 index pages reread; repeated generation created no duplicate.
No production build, full regression, live deployment or activation was performed.
