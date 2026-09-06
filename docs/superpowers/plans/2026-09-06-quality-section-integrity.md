# Quality rubric: current, real section context

## Evidence

The quality rubric used an independent trim-and-regex Markdown parser. Fenced
and commented example headings/content counted as experiment or knowledge-role
sections, while real Setext headings did not. A sibling Setext body could fill
an empty ATX section. Failed-check inspect actions were not revision-guarded.
Thirteen RED tests demonstrated these gaps before the implementation change.

## Contract

Reuse the common physical root heading ranges and matching-fence visibility.
Section context excludes Properties, fenced examples, recognized raw HTML blocks, comments, empty wikilink/checklist
placeholders and thematic dividers. Descendant prose can fill a parent section;
siblings cannot. This is explanatory authoring structure, not factual evidence,
a protocol execution check, or a publication gate. Keep commands fenced, with
descriptive prose outside them. No Markdown content is changed automatically.

Read actions preserve the assessed revision. At tiny budgets retain the exact
scoped path, guard, whole-rubric score and failure before the redundant legacy
nextActions list. Longer identifiers still receive a same-request budget retry.

## Verification

- Initial expanded quality suite: 13 failed, 35 passed.
- Adding guards exposed two existing 512-character scoped-action failures;
  removing only duplicated failed-check IDs recovered both without losing guards.
- Review identified commented fence state, empty checklists and inline heading
  comments: eleven new RED cases. Each fix was verified separately.
- A broad comment state initially interfered with inline literal markers; three
  new RED tests established that only root comment blocks can control block
  visibility. Three more exposed local quality stripping of literal markers.
  Existing closed-code masking and escape parity protect those local openers.
- Root comment lines must also stay out of fallback paragraphs (two RED cases).
  Existing HTML block termination and trailing explanatory prose are preserved;
  shared heading/visibility classifiers now reuse the same HTML block patterns.
- Whole visible-snapshot literal masking retains multiline inline-code context
  (two RED cases); skipped blocks keep newline gaps. Raw HTML lines share an
  internal literalBlock marker so their code-looking text cannot poison that
  mask or count as explanatory context (eight RED cases and a positive case).
- Targeted quality, MCP, Setext and pure section suites: 153 passed.
- Compiled five-tool MCP smoke passed real/fake section assessment, literal
  markers, checklist rejection, bounded guarded recovery, changed-source
  conflicts and comment-free fallback prose. Temporary fixture was removed.
- Final full suite passed: 1,955 tests, one existing skip, 140 files, 77.78 seconds.
  Fifty new tests plus the strengthened existing revision-action assertion.
- Independent final read-only review found no additional concrete regression
  in literal-block visibility or mask offset accounting. Reviewer closed.
- Final artifact build/test and compiled MCP smoke passed after the tool-description update. No live
  Vault/server changes, upstream contribution, package publishing or accounts.
