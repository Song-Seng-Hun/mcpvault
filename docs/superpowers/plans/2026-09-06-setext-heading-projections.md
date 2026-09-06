# Setext heading projection integrity

## Evidence and scope

The shared source projection recognized only ATX headings. Valid underlined
Markdown titles were missing from outlines and learning-locator validation;
composition paragraphs included heading syntax. The preceding qualified-path
batch explicitly left Setext support open.

Primary references checked 2026-09-06:
- https://daringfireball.net/projects/markdown/syntax#header
- https://spec.commonmark.org/0.31.2/#setext-headings

## Implementation

Use shared physical heading ranges over the same authorized snapshot and
existing Properties/matching-fence filter. Accept eligible root paragraph text
followed by a level-1/2 underline, including multiline titles. Preserve physical
first lines and complete underline ranges. Reuse these ranges for outline,
summary, requested presence, mixed qualified ancestry, section reads, split
previews and composition prose exclusion. No new MCP tool or runtime dependency.

Preserve paragraph interruption and block-specific suppression boundaries for
recognized lists, indented code, tables, reference definitions and HTML. Table
delimiter cells are scanned linearly; never use ambiguous overlapping whitespace
repetition on untrusted rows. Retain only the current candidate title paragraph
while streaming headings, not a full outline for presence/summary. Paragraph
projection has a second streaming range pass; this is not a total-I/O or heap cap.

This remains a source projection, not a full Markdown renderer, inline display
normalizer, Obsidian UI verification or nested-container/plugin heading parser.
No live Vault/server/account changes; verification uses temporary Vaults.

## Verification log

- Initial reproduction: six failing cases, including real-service checkpoint
  rejection and paragraph pollution; existing negative cases still passed.
- Code/list boundary follow-up: two additional RED cases, then GREEN.
- Independent review: four actionable findings reproduced as four RED tests,
  including a 64k-space malformed delimiter taking 2,541 ms. Linear scanning and
  block-specific termination fixes made all 27 Setext tests pass (14 ms total).
- First full suite before follow-up fixes: 1,848 passed, one existing skip,
  138 test files.
- Follow-up review reproduced two more list-exit/containment failures. Both
  passed after root ATX exits cleared list context and nested containment was
  checked on every line, not only the first line after a blank.
- Final targeted suite: 72 passed. Final build passed. Full suite: 1,857 passed,
  one existing skip, 138 files, 76.09 seconds. Final compiled five-tool MCP smoke
  verified learning-locator acceptance, physical section/split boundaries,
  bounded responses, matching source revisions, no read-side mutation, and
  rejection after removing a real underline. The temporary Vault was cleaned.
- Final read-only review approved the fixes with no additional critical
  integrity/performance findings. The reviewer was closed after completion.
