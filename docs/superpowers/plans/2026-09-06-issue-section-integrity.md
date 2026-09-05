# Preserve Error Book sections and literal bodies

## Reproduction

Six initial tests demonstrated data loss: the old Resolution-to-EOF regex
matched fenced examples/title prefixes, erased later evidence and appendices,
overwrote omitted authored retrospective prose from old metadata, and accepted
ambiguous managed headings. A seventh test showed invisible section writes
inside an unclosed source fence.

## Repair

- Shared outline/fence scanner, exact H2 section identity and peer/parent
  boundaries. Apply independent range edits from end to start; append only
  genuinely missing sections. Do not rewrite unrelated Markdown.
- Preserve an omitted retrospective; status-only changes retain its prose.
  Authored retrospective text can support a status transition even when the
  compact Property is absent. Earlier revisions stay in Git.
- Validate source/result structure and each replacement's fence balance before
  the existing single revision-checked write. Astra's paired-input fence case
  was reproduced red and covered: independent inputs cannot balance around
  preserved evidence and cause a later resolution to erase it.
- A raw-body thematic-break test exposed the shared serializer reparsing body
  strings as YAML. Two direct regressions proved body text was dropped/imported
  into Properties. Pass the documented {content} overload to gray-matter in
  both explicit-Properties and no-existing-matter fallback serialization. Raw
  writes with no Properties keep their existing behavior.

## Verification

- Focused issue/frontmatter/heading/composition tests: 48 passed. Fresh build
  passed. Full suite: 1527 passed, 1 skipped, 114 files (70.14 seconds).
- Astra's paired-fence finding was reproduced red, repaired with independent
  replacement checks and re-reviewed. Its bounded in-memory checks covered
  both fence styles and 11 serializer body variants; no remaining actionable
  finding was reported. The reviewer did not run the build/full suite and was
  closed after review.
- Compiled MCP smoke registered one disposable fixture account, resolved and
  re-read the same issue, checked preserved code/evidence/retrospective and
  rejected paired fences without changing the revision. Literal body YAML
  remained outside Properties and the five-tool surface stayed unchanged.
- The owned temporary Vault (including its fixture account) was removed.
  Diff check passed. No live issue, account, server or Vault was modified.
