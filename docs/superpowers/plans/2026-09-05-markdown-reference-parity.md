# Markdown path parity and unresolved relocation

## Proven failures

Ordinary `(Target.md)` links used wiki basename/alias lookup in graph and
review while moves already used source-relative paths. Red tests reproduced
wrong-folder backlinks and reference ambiguity in indexed and fallback modes.
A further red test caught `.md` silently resolving to `.markdown`.

Source relocation left missing links untouched, allowing a destination sibling
to become the target. Outgoing ambiguity and out-of-vault destinations also
passed unchecked. Regression tests reproduced all three cases before fixes.

## Implementation

- Shared markdownNotePath plus exact-path mode in the note identity resolver.
- Folder-qualified Markdown paths start at the Vault root; ./ and ../ are
  explicit source-relative paths. Generated child-folder Markdown links retain
  ./ so a move cannot change their interpretation.
- Reused indexed/fallback filesystem lookup; no new persistent index or MCP tool.
- Graph edges and context/heading privacy projection retain original syntax.
- Reference validation and review baselines distinguish Markdown from wikilinks.
- Source relocation preserves missing local destinations lexically, rejects
  ambiguity and unpreservable out-of-vault references, and does not relocate
  outgoing links for same-folder renames.
- Delete preview excludes the deleted source's outgoing relocation plan. A red
  regression caught the new relocation guard blocking unrelated delete previews.
- Vault-root wikilink targets render as explicit ./ or ../ paths during moves,
  including missing targets; another red test caught bare root names rebinding
  to destination siblings.

## Invariants and limits

Caller visibility, reference direction, PathFilter, revision-safe writes,
bounded responses, and ordinary Markdown/Git authority remain intact. No live
Vault, account, server restart, plugin installation, or upstream action.

Plain Property path relocation was subsequently audited and corrected in
`2026-09-06-plain-property-relocation.md`. This does not implement a complete CommonMark parser, change
read-only authorization, or repair already-authored private content.

## Verification

- Sol's scoped independent review flagged extension omission. This suggestion
  was checked against the primary Obsidian documentation rather than adopted:
  https://obsidian.md/help/links explicitly treats `(Note)` and `(Note.md)` as
  equivalent. Omission remains supported; an explicitly written suffix cannot
  be substituted. Tests cover omission and exact suffixes. Reviewer closed.
- The same primary documentation clarified root-qualified folder paths. Red
  tests and generated-link fixes enforce the distinction from ./Folder/Note.md.
- An initial compiled five-tool MCP fixture passed graph/review target parity,
  target-edit detection, unresolved move preview/execution/re-read and no
  destination sibling rebinding. Owned fixture and account removed.
- Final full suite: 1343 passed, 1 skipped, 102 files (57.58 seconds).
  Build and diff check passed.
- Final compiled five-tool MCP fixture passed root-qualified folder paths,
  explicit relative Markdown, root and missing wikilink relocation, mutation
  re-read, and exact backlinks. Owned fixture/account removed.
