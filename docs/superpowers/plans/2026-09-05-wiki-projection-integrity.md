# Wiki projection and split-preview integrity

**Goal:** Make progressive reading and atomic-note split previews select the authorized source's real section/block, not stale locators, examples, ambiguous matches or repeated boundary context.

**Architecture:** Reuse the pure raw-note projection module for outline and terminal block anchors. `readProjection` and `previewSplit` use one ParsedNote for moderation, revision, outline and extraction. Reject ambiguous heading/block selection instead of guessing; guide users to outline and revision-pinned line reads. Preserve preview-only operation and existing endpoints.

**Execution:** Inline (no new agents), using the existing autonomous fork-only authorization and TDD/verification workflow.

- [x] Add public MCP regressions in `src/wiki-projection-integrity.test.ts`: real-file races, hidden sources, exact-before-partial heading selection, duplicate headings/block IDs, Properties/fence/prefix block decoys, and clamped nearby context.
- [x] Observe failures before changing production code.
- [x] Share physical visible-line traversal in `src/note-projections.ts`; expose pure block-line projection and unambiguous section selection. Keep matching-fence and frontmatter semantics of the existing outline.
- [x] In `src/llm-wiki.ts`, replace second outline reads with snapshot projection, reject hidden split sources, and use exact/unique selection. Build context from in-range adjacent lines only.
- [x] Verify split preview/retrieval response bounds and document that truncated text is not a complete extraction suitable for copying blindly.
- [x] Update endpoint descriptions, README/schema and roadmap without growing the injected AGENTS.md. Run targeted tests, full tests, build and compiled public smoke before fork-only commit/push.

## Evidence-driven scope additions

The 512-character public adapter erased split sourceRevision and section ranges.
`src/createServer.ts` now applies a presentation-only envelope retaining the
already-checked identity/range and a guarded full-range recovery action. REST
uses the same runtime dispatcher (`src/rest-api.ts`), not a duplicate workflow.

Recovery-path tests also reproduced a moderation bypass outside Community
folders in direct note/Properties/outline/line reads. Batch shaping could omit
Properties before checking moderation or trust an unchanged metadata shortcut.
The common direct-read guard is now folder-independent; public batches check
current snapshots (at most ten), then filter hidden rows and omit requested
Properties/unchanged bodies. Internal filesystem snapshot caching was not made
an alternative authorization system. This intentionally trades those bounded
batch source reads for correct current visibility; response-token savings stay.

## Audit boundary

This is not a graph snapshot transaction, a multi-file write transaction, or a new promise that all read models are current. Those audits remain open. The shared authority stays raw Markdown and its source revision.

## Evidence

- Initial RED: 12 of 13 tests failed with actual new headings paired to an old
  revision, misaligned split content, hidden preview exposure, wrong/ambiguous
  anchors and repeated boundary context. One existing hidden-projection test passed.
- Additional RED: two tiny-response tests lost section/sourceRevision; four
  direct fallback tests and two batch tests reproduced moderation bypasses.
- Targeted projection/filesystem group: 210 passed, 1 skipped. Extended public
  integrity/server group: 63 passed, including visible batch omission/unchanged
  compatibility. New integrity file has 22 tests.
- Strict build found an explicit undefined optional-property type in the batch
  map; conditional property construction fixed it. Final build exited 0.
- Final full suite after the type correction: 66 files, 1035 passed, 1 skipped,
  43.03 seconds. `git diff --check` passed.
- Compiled public MCP smoke passed on owned temporary Markdown: actual edit
  after snapshot read retains original projection; newly hidden direct and
  metadata-omitting batch reads are denied; a 512-character split reply keeps
  the source revision/range and a guarded recovery action.
- Inline review verified no new fixed tools/dependencies, no Vault mutations by
  preview, no private candidate list in ambiguity errors, and no extra metadata
  load needed to authorize projection. Existing internal readProjection callers
  retain their service object shape; response envelope changes are adapter-only.
- Open boundaries: generic query/aggregate hidden-row filtering/counts and graph
  freshness; full multiline Obsidian block expansion; retained multi-request
  snapshots and multi-file transactions. Do not interpret these tests as proof
  that all organization endpoints have completed those audits.
