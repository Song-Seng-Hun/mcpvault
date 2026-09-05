# Source-relative review links

## Observed defect and contract

The common note resolver already accepts a source path, but filesystem and
metadata-index adapters discarded it. Reference validation and review baselines
therefore omitted `../Target` links. The occurrence parser also normalizes `./`
away, so body wikilinks need their authored spelling during resolution.

Keep Markdown/Git authoritative, the five-tool MCP surface unchanged, bare-name
ambiguity unchanged, and the existing 50-target baseline limit. Propagate the
source path through publish, review and later queue/impact/cascade comparisons.
Preserve caller identity for explicit references and do not derive private
target revisions into public notes. No live Vault mutation or new daemon.

## Implementation and evidence

- Reproduction failed for indexed and non-indexed `../Target` references.
- Filesystem and metadata-index adapters now accept optional sourcePath.
- Explicit references and body wikilinks retain source path and principal.
- Review capture and comparison use the same source-bound resolution.
- A second red test demonstrated private target revisions being copied into a
  public note during review; baseline capture now applies reference direction.
- Tests cover same-name alternatives, `./`, `../`, heading/alias and table alias
  syntax, unchanged versus modified targets, indexed parity, authenticated
  private references, anonymous denial, and public/private baseline separation.

## Boundaries / next audit

This change does not introduce a new Markdown-link resolver. Ordinary Markdown
links without explicit `../` still need an audit across graph, move, reference
and review readers for source-relative parity. The occurrence parser strips
`./`; this batch preserves authored wikilink spelling in reference/review
readers, but graph and move readers still need their own parity checks.
Existing authored sensitive
content is not automatically removed. Baselines remain bounded, not a
transactional snapshot of every target. Moderation and overflow behavior of
baseline capture should be audited independently rather than claimed fixed.

## Validation

- Final full `npm test`: 1328 passed, 1 skipped, 102 files (59.00 seconds).
- Focused review-body suite: 14 passed, including both indexed and unindexed
  public/private baseline separation.
- `npm run build` and `git diff --check`: passed.
- Compiled five-tool MCP fixture: registration, source-relative review capture,
  unchanged queue, target write and re-read, changed-target trigger in compact
  and pretty formats, and stale review revision rejection all passed. Owned
  temporary accounts/files were removed with the fixture.
- An earlier grouped test run hit the existing Git test's 5-second timeout;
  its isolated retry and the subsequent full suite passed without raising the
  timeout. The first compiled smoke incorrectly expected a frontmatter field
  in the bounded notes.read projection; validation was corrected to inspect
  the fixture's authoritative Markdown after the MCP re-read.
- Luna's bounded review found no introduced defect; its indexed security-test
  gap was addressed by running the private-baseline regression in both modes.
  The reviewer was closed immediately after delivering its result.
