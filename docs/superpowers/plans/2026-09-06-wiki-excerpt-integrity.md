# Wiki fallback excerpt integrity

## Reproduction

`readProjection` split the body on blank lines, then removed whole blocks
starting with `#` or three backticks. This discarded prose immediately after
ATX headings, retained Setext syntax, and accepted tilde-fenced examples as
fallback summaries. Headingless long excerpts recovered via an empty outline
instead of the actual source. Ten new MCP tests failed before implementation.

## Changes

- Use the existing snapshot-based paragraph projection lazily only for body
  fallback. Keep summary/progressive metadata and claim precedence unchanged.
- Key-points reads now honor authored `key_points` (up to eight nonempty string
  entries) before falling back to the body; this mismatch had its own RED test.
- Select up to one body paragraph for summary/progressive or five for key
  points. Retain at most maxChars+2 candidate prefix characters, including an
  overflow sentinel/paragraph separator. This is not a source I/O or parser heap
  bound: the original note and paragraph projection still process source text.
- Return `contentSource: body_excerpt` and the physical `excerptRange` envelope
  from the captured originalContent/revision. This is not an authored summary,
  not exhaustive note coverage, and not a concatenation instruction.
- Keep excerpt identity/range in compact output and recover via revision-pinned
  physical line reads. The range may include intervening headings/examples;
  recovery is original source context that replaces the preview.
- Do not mutate the note, stored summary or freshness fingerprint. No new MCP
  tool, client installation, live Vault operation or server restart.

## Verification

- Initial new suite: 10 RED, 3 existing-behavior tests passed.
- Paragraph separator at the character ceiling: additional RED, then fixed so
  the next selected source remains in the recovery envelope.
- Authored key-points precedence: additional RED, then GREEN.
- Review follow-up: blank claims suppressing authored key points plus empty
  summary/progressive metadata reproduced as three RED tests. Content selection
  now ignores blank text without changing stored metadata or freshness status.
- Targeted excerpt + existing projection integrity tests: 40 passed.
- First full suite before the final key-points addition: 1,871 passed and one
  existing skip, 139 files, 80.61 seconds.
- Final build passed. Final suite: 1,875 passed, one existing skip, 139 files,
  75.84 seconds. The final compiled five-tool MCP smoke verified all fallback
  views, empty metadata selection, matching-fence exclusion, physical source
  locators, no read mutation, 512-character headingless recovery and rejection
  after a concurrent source edit. An initial smoke assertion miscounted the
  fixture's source line; correcting that assertion required no production edit.
- Independent read-only review confirmed the blank-metadata fix and no further
  actionable issues. Reviewer closed; isolated temporary Vaults cleaned.
