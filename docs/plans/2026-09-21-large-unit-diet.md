---
id: large-unit-diet
kind: implementation-record
description: Reduce duplicate implementation and test setup without dropping behavior.
keywords: [diet, Luna, tests, HTTP, paging, 코드 다이어트]
use_when: Continuing the approved large-unit refactor or checking its measured scope.
position: Release record; transport detail in the next chapter.
previous: 2026-09-21-discovery-diet.md
next: 2026-09-21-http-read-diet.md
---
# Large-unit diet (대단위 다이어트)

Base: `755e4374f`, existing main. Preserve unrelated edits and skill quarantine.
Count handwritten source, tests and scripts; exclude generated output and formatting.
Targets: 5% net lines, 30% cumulative model input, 70% local validation time.
Targets are not measured results. No token billing estimate from byte counts.

## Work ownership

- One existing Luna worker: test duplication, retained-case mapping, target execution.
- Main: transport/output changes, safety boundaries, integration and deployment.
- No new agent fleet, diet checker, plugin engine or skill activation.
- Reuse tests; do not add tests whose only purpose is to assert code shrinkage.
- Full regression once on the final frozen engine bundle; affected tests during edits.

## Packages

1. Consolidate test resource cleanup; preserve unique assertions and isolated state.
2. Reuse HTTP guards and social validation; retain boundary-specific authorization.
3. Share exact JSON paging between descriptors and selected read views.
4. Bound large-string candidate fragments before serializing response envelopes.

God-file extraction alone is not a net reduction; do not count moved lines.
Do not broaden parameter forwarding or merge distinct approval/recovery semantics.
Retain REST/storage JSON. Automatic organization-manifest paging is MCP-only.
Other responses still need operation-specific receipt/continuation migration.
Universal 5KB coverage, TSV/TOON selection and live Antigravity checks remain open.
No new serializer dependency until representative output round-trips show benefit.
Official TOON 4.1.1 round-trip probe: 20 current tool cards 8852->8410 bytes;
first current tool schema 663->703; synthetic uniform rows 1599->868 (TSV 941).
Cards save only 5%; schema grows. No runtime dependency adopted; tokens unmeasured.

## Stop and delivery

Prefer packages with >=1,000 net lines or >=20% measured-path improvement potential.
After two consecutive below-threshold candidates, stop widening the refactor.
Finish validated edits; report unmet targets rather than deleting required behavior.
Build/full regression: 567 files; 7467 passed, 4 skipped, 0 failed; 2916.11 seconds.
Handwritten src/tests/scripts: -304/187338 lines (0.16%); docs +100; 5% goal missed.
NAS deployed; public reads verified. Skill quarantine retained; token/time goals unproven.
