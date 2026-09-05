# Literal-safe tags implementation plan

Execute inline with executing-plans, TDD and verification-before-completion.
The user authorizes autonomous fork-main implementation and push; no new agents.

## Design

Use one body-tag extractor in graph discovery and per-note tag management.
Reuse the existing offset-preserving Markdown literal mask rather than a second
fence/backtick implementation or a new Markdown dependency. Preserve repeated
occurrences for graph counts; note management continues its existing deduplication.
Ignore escaped hashes, code literals, heading markers, URL/word fragments and
numeric-only hashtags. Preserve nested tags and Unicode letters/marks/emoji,
including Korean and emoji. Keep spelling in per-note results; graph counts retain
case-insensitive normalization. Frontmatter tags retain their existing semantics.

The alternative of fixing only the graph leaves management able to persist tags
from examples. A new parser dependency would broaden deployment and compatibility
costs unnecessarily. The shared scanner inherits its documented limitations:
not a complete HTML, indented-code or Obsidian rendering parser.

## Steps

- [x] Add real-file graph/service regressions in `src/markdown-tags.test.ts`:
  matching/mismatched fences, closed/unclosed inline spans, escapes, Unicode,
  nested tags, repeated occurrences, and add operations not promoting examples.
  Run `npm test -- src/markdown-tags.test.ts`; observe incorrect tag sets.
- [x] Export `buildMarkdownLiteralMask` from `src/backlinks.ts` and reuse it in
  `src/markdown-tags.ts`. Replace both body regexes with
  `extractInlineTags(note.content)` / `extractInlineTags(parsed.content)`;
  preserve existing write authorization and frontmatter handling.
- [x] Run focused tag/backlink/graph/filesystem tests; inspect warm invalidation
  and public `call_endpoint` discovery, plus no body change on tag add.
- [x] Update endpoint help, README/schema and roadmap. Run build, full tests,
  compiled isolated-vault smoke and diff check. Commit source/tests/docs/dist
  and push only `Song-Seng-Hun/mcpvault` main; verify remote SHA.

## Evidence source

https://obsidian.md/help/tags: nested slash tags, non-numeric character rule,
case-insensitive tags and Unicode support. This implementation does not claim
complete equivalence to every Obsidian parser context or normalization rule.

## Verification

- Initial real-file regressions: seven failures, one existing behavior passed.
  Failures included literal tags persisted into Properties and truncated nesting.
- Review caught overly broad Unicode Symbol matching consuming Markdown
  backticks; a new adjacent-delimiter regression failed, then passed with the
  explicit letters/marks/numbers/emoji tag alphabet. Existing link-mask behavior
  remains unchanged; escaped hash parity belongs to the tag extractor.
- Final focused run: 213 passed, 1 skipped, four files. Full run: 1095 passed,
  1 skipped, 72 files (48.54 s). Build passed, including after final help text.
- Compiled server smoke over an isolated real vault verified tag add, unchanged
  body, complete nested Properties, bounded public MCP discovery and occurrence
  counts excluding code examples. Only the validated owned temp fixture was
  removed. No live Vault writes or server restart.
- Shared-parser scope does not change existing Properties-only removal,
  frontmatter validation/normalization or write concurrency. These limitations
  remain visible in the endpoint help/roadmap rather than being silently claimed
  as fixed. No new MCP tools, dependencies or client setup.
