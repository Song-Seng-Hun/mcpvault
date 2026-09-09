# Community skill library validation — 2026-09-09

## Scope

The user approved Community sharing. The active Vault is
`\\172.30.1.24\MCPVault`; local source/build remains `E:\dev\llm_wiki`.
Only this session's explicit 158-entry registered skill catalog was inventoried.
No arbitrary cache versions, scripts, credentials or private manifest paths are
published. No new fixed MCP tool, model, database or client installer is added.

## Admission and preview

The final pre-write preview admitted 37 skills as 219 Markdown documents
(primary SKILL.md, available references, and retained license/attribution).
120 sources lack established admitted sharing terms; one source contains a
recognized sensitive path and remains held. Installation alone was not treated
as redistribution permission. Full private manifests and per-file receipts live
outside source Git, under `.mcpvault/skill-import/`.

All 219 targets were absent; no existing note needed replacement. Source and
projection hashes plus current revisions bind the import plan. Repeated input
must be a no-op; local content, Properties and YAML-comment edits must survive.

## Regression evidence

- RED/GREEN reproduced and repaired source-root/ancestor junction admission and
  YAML-comment loss on source refresh.
- 79 focused skill/organization/policy tests passed before final integration.
- A new MCP integration test reproduced the Community-path exclusion in
  situation context. Skills now appear as `procedural_reference`, never verified
  evidence or authority; existing managed social metadata keeps its classification.
- 52 question/situation/skill MCP regression tests passed after that repair.
- TypeScript build and generated-guidance consistency check passed.
- First full single-worker run: 4,189 passed, 3 failed, 2 skipped (321 files).
  Two failures exposed a 4,000-character Property-contract budget cliff after
  vocabulary growth. The fallback now preserves field names and native editing
  guardrails while explicitly deferring relation details. The third was an
  existing integration test's 5-second timeout; no timeout was raised.
- All three failed tests then passed in 1.74 seconds of test execution. The
  subsequent full run passed all 321 files: 4,192 tests passed, 2 skipped.

## Live NAS finding and repair

All 219 documents were created and reread with matching revisions/digests.
Re-preview reported 219 unchanged. Guidance sync created and verified 35 new
notes and preserved 3,833 unchanged notes.

The first live MCP search exposed an existing UNC-root bug: arithmetic path
slicing removed the first character (`Community` became `ommunity`) and thus
misclassified the scope. An isolated fixture also reproduced private-prefix
filter bypass. No production private document was queried for reproduction.
The old shared server was stopped while repairing this boundary.

Search now uses standard relative-path calculation for full, dirty and shared
catalog indexing; semantic fallback traversal uses the same path semantics.
Search snapshot version 7 discards old potentially malformed derived paths and
rebuilds from Markdown. Skill search titles now use their bounded declared title;
ordinary note filename display remains compatible.

- Post-repair targeted tests: 56 passed; build and guidance check passed.
- Final full single-worker regression: **321 files passed; 4,194 tests passed,
  2 skipped** (741.80 seconds). No timeout was increased.
- Shared server restarted as verified PID 37188 at `127.0.0.1:8788`, using the
  NAS Vault. No duplicate server was launched and no client installation changed.
- Current Codex MCP search returned exact `physicalPath: Community/Skills/...`,
  `scope: community`, and the namespaced skill title rather than `SKILL`.
- Live `notes.read`, `wiki.note_template`, and focused `wiki.property_contract`
  confirmed the new skill kind, provenance, and current revision.
- Live `wiki.context_pack` returned TDD excerpts as `procedural_reference` under
  4,000 characters with an explicit incomplete/evidence warning. Its exact
  revision-guarded continuation succeeded, rather than requiring a guessed path.
  Representative revision:
  `2d38c2a2601e41aafe8ede0ab061101e55f4dfc9a0c7a80536f44181add94f17`.

The scope-label fault was a derived-path bug, not a copy of these skill documents
into Global storage. Tests used synthetic private content; these checks do not
claim a forensic audit of historical access. Imported documents remain in
Community, and the federation rejection test remains passing.

## Limits

These are imported procedural references, not 37 newly callable tool packages.
Original relative host paths and omitted scripts/assets require adaptation and
separate authorization/availability checks. Semantic search uses the existing
service; no new embedding model is installed. Protocol tests do not prove every
external tool works, and Obsidian editing UI was not automated.
