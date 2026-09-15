---
id: reviewed-skill-metadata-wave8
description: MCP registry and prompt-management metadata with license-association and authority gaps.
keywords: [agent-bom, prompt-management, licensing, current-access, 프롬프트 안전]
use_when: Reviewing these agent-tool references or resolving imported license provenance.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-receiving-v3-package.md
next: 2026-09-15-reviewed-skill-release-passport-next.md
---
# Metadata wave 8

Main read all eight retained files, 17,225 bytes; three current NAS fingerprints rechecked twice.
No source, installed package, MCP registration, cloud prompt, credential or host grant changed.

## Findings requiring resolution before release

| Target | Useful scope | Unresolved limitation |
| --- | --- | --- |
| agent-bom-registry | Registry/package trust assessment | MIT import label conflicts with Apache-2.0 in its card. |
| agent-platform-prompt-management | Managed-prompt creation proposal | Post-confirmation demand forbids reporting unavailable access. |
| ai-prompt-engineering-safety-review | Discovery lead for prompt review | Only truncated risk questions remain; detailed framework absent. |

BOM quick start installs an unpinned third-party scanner; no installation occurred.
Its CLI mcp scan is not itself new MCP registration or a host permission grant.
Optional SNYK_TOKEN, enrichment and Semgrep are named, not configured or authorized.
Test count, telemetry, commercial-readiness and Scorecard claims were not externally verified.
Prompt creation can persist data remotely; project/region/model consent needs current access too.
Source's simulation-harness claim cannot dictate host tool behavior or override honest failure reporting.
The creation snippet lacks demonstrated retry/ambiguous-success handling and a verified runtime.
Both prompt entries advertise absent scripts/run.sh; the safety entry supplies no tests or full procedure.

## License association gap

All three import notices reuse the same Jesse Vincent MIT text despite different origin labels.
Two origin URLs name organizations, not exact repository/file/commit locations.
The BOM card additionally contradicts its import label; actual governing terms remain unresolved.
readSkillSource/projectSkill recognize license wording, not applicability to the exact imported source.
A parent-repository license may legitimately be outside the skill folder; do not reject by location alone.
Actual historical manifest selection was not inspected, so the creating operation is not identified.
Resolve immutable upstream artifacts and scoped license evidence; do not silently replace original terms.

## Verification and progress

Three descriptors, eight exact quote ranges and 24 negative controls passed.
Evidence SHA: `f3de5654221e53ccf55afeca14ee58d3dca8259b607aa4dac3577e4316cb4def`.
Seven conditional impact axes completed; policy/legal applicability and usage remain explicit unknowns.
Index `878a252bc7e9e0e9`: 26 pages; all 1,610 rows reread; repeated build creates nothing.
Totals: 47 metadata-reviewed-with-limitations, zero drafts, 1,563 pending, zero verified live usable.
Private source/evidence excluded from Git; original quarantine and production source/dist unchanged.
Existing regression-e source/build basis revalidated; no new full-suite run or deployment claimed.
