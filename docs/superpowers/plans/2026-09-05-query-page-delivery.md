# Query page delivery implementation plan

> Execute inline with executing-plans and TDD; no new agents. Existing user authorization covers implementation and fork-main delivery.

**Goal:** A bounded public query never skips an undelivered row, truncates an executable locator, or reads an entire large result set merely to discard it during JSON compaction.

**Architecture:** Public adapter selects one metadata page, then a dedicated page packer incrementally delivers complete rows or explicitly omitted-field locators. Cursor sort values come from original selected metadata, even when Properties are omitted from a projection. Checked hydration shares revision/visibility guards with existing query hydration. Bounded raw-source IO runs through the shared coordinator with a limit-specific deduplication key. No historical snapshot or new MCP tool is introduced.

**Alternatives:** Generic compaction loses pagination provenance; fixed tiny limits still fail on one oversized row. Choose serialized-size-aware delivery with explicit recovery. Reuse existing metadata selection and services rather than duplicating access logic in a REST controller.

## Contract

- `limit` is an upper bound. Deliver a contiguous prefix; `nextCursor` identifies the last actually delivered original row. No cursor if nothing fits.
- Full Properties/content are never silently clipped. An oversized row can carry `frontmatterOmitted` / `contentOmitted`, `sourceState: index_advisory` when not hydrated, and an exact revision-guarded `mcp.get_note_outline` action. Missing fields are not empty authoritative values.
- All response text, including pretty JSON, fits normalized maxChars (512..20000). If one exact locator/cursor cannot fit, return a bounded error and a same-request budget retry, without a cursor or fabricated/shortened identifiers.
- Hydrate only rows that can fit at least their locator. Stop at the first undeliverable row; do not compact it to skip a valid later row. Changed/deleted/unreadable hydration fails the whole page, not a successful partial page.
- Per source read <=256 KiB plus one overflow-detection byte; per public query at most 1 MiB of attempted raw-source bytes. Oversized/exhausted sources return advisory locators and guarded follow-up reads. Bounds do not cover metadata-index startup or independent follow-up reads.
- Internal query defaults and exact-count meanings stay unchanged. Cursor sequences remain stateless and must keep filters/sort unchanged.

## Tasks

- [x] Add public real-vault regression for 12 metadata rows at maxChars=512: continue until complete, assert exact paths once and last-delivered cursor. Reproduce current generic-compaction failure.
- [x] Add bounded-source reader tests for limits, growth after stat, missing/IO failures; add coordinator tests proving limit-specific coalescing and no unbounded-reader reuse.
- [x] Implement source reader and coordinator bounded scheduling; preserve path-free failures at the query boundary.
- [x] Add pure query-page tests for sort/missing keys, first oversized row, Unicode identifiers, tiny-budget errors and pretty print. Implement prefix packing with exact serialized budgets and original-row cursors.
- [x] Expose bounded service query using existing metadata query plus shared checked hydration. Public query forwards normalized maxChars. Verify whole-page revision/error guarantees remain true.
- [x] Add public integration for omitted-field guarded recovery and source IO count/byte bounds. Update README, schema, registered description and roadmap.
- [x] Run targeted tests, build, full tests, compiled isolated-vault MCP smoke, inline review, diff check. Deliver source/tests/docs/dist together only to Song-Seng-Hun/mcpvault main.

## Completion evidence

- Initial real public MCP tests reproduced missing `notes` under generic compaction
  in both total modes. Bounded IO/scheduler tests failed before their implementation.
- Review tests additionally reproduced a suggested retry budget that failed again
  because its own nextAction numeral grew, and an expected size rejection reducing
  IO concurrency from 8 to 7. Retry sizing now uses the longest allowed numeral;
  size rejection is not classified as a storage failure (latency backpressure remains).
- Final targeted query/page/IO/revision tests: 29 passed. `npm run build` passed.
  Final `npm test`: 1,070 passed, one skipped, 70 files, 45.73 seconds.
- Compiled `dist/src/createServer.js` MCP smoke: 512-character body pages delivered
  all 12 source paths exactly once; a 300,000-character source returned an advisory
  omitted-body locator whose revision-guarded outline action succeeded.
- Inline review checked cursor construction from original rows, shared access and
  hydration guards, optional-field meaning, limit-specific coalescing and bounded
  no-cursor failures. `git diff --check` passed. No new fixed tools or client setup.

Do not infer live deployment from compiled smoke. Metadata-index construction,
large Properties parsing/serialization, internal unbounded service scans and
independent follow-up IO are outside the new per-query source budget. Broader
graph/aggregate visibility, cross-process snapshots and global memory limits
remain separate audits. Existing user `.agents/` and `.mcpvault/` are not staged.
