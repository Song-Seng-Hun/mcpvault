# Project packet budget and real planning headings

> Execute inline with TDD and verification-before-completion. No new agents.

**Goal:** Project planning must not mistake fenced examples for real planning
sections, exceed its serialized response budget, or silently strand later rows.

**Architecture:** Reuse projectNoteOutline once per body. Add a pure project
packet packer over ranked public rows. Preserve normal full rows when they fit;
oversized details become explicit summaries with exact path/revision and a
bounded notes.read action. Page by emitted rows; a visible-result fingerprint
guards continuations. Measure compact and pretty JSON exactly. A record whose
exact identity cannot fit gets a same-position larger-budget retry or explicit
ceiling error, never a clipped path or skipped project.

**Trade-off:** Current APIs retain their default first-page fields. New offset
and expectedSnapshot options belong to the existing dynamic endpoint, not new
MCP tools. Recomputing the ranked cohort per page retains whole-graph cost; this
is a response integrity fix, not historical snapshots or global memory bounds.

**Files:** src/project-packet.ts, src/project-packet.test.ts,
src/project-planning.test.ts, src/llm-wiki.ts, src/llm-wiki-tools.ts,
src/createServer.ts, README.md, _wiki/SCHEMA.md, roadmap and generated dist.

- [x] Reproduce fenced heading false positives and over-budget service output.
- [x] Implement fence-aware single-pass section recognition and pure packing.
- [x] Wire optional offset/fingerprint/pretty settings through existing adapter.
- [x] Verify exact identities, unchanged/changed continuations, empty/oversized
  records, pretty budgets and compiled five-tool MCP behavior on a temp Vault.
- [x] Build/full tests/diff check and inline review. Fork-only commit/push is
  verified separately in execution output, not inferred from local tests.

## Evidence and remaining scope

- Baseline: four failures reproduced false ready=true from fenced headings and
  a 19,054-character response for a 512-character request.
- New coverage: 16 tests across packet packing and planning, including real
  matching closers, thematic breaks, minimum pretty budgets, exact identities,
  full traversal, changed off-page records, omitted list details and ceiling
  failure. An added test caught collision with authored `nextAction`; source
  follow-up is now `readAction` and task text is unchanged.
- Related targeted run: 27 passed. Build/diff check pass. Full suite: 1,242
  passed, one skipped, 92 files, 58.71 seconds.
- Compiled MCP: fixed five tools, 363-character pretty minimum-budget retry,
  seven public projects visited once, private project excluded, fenced headings
  rejected, and a changed off-page project rejected the old continuation.
  Temporary test Vault/account removed; no live server or Vault changes.
- Inline review checked adapter formatting, stable fingerprint inputs, emitted
  offsets, path preservation, retry termination and authored-field compatibility.
  Whole-cohort ranking, work-graph memory, external-writer atomicity and other
  organization endpoint response packers remain separate audit topics.
