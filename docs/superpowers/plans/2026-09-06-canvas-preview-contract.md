# Canvas preview/export consistency

## Contract and findings

An agent following `wiki.canvas_view.exportAction` must either save the same
selected graph or receive a conflict. The action previously dropped depth,
limit, budget and semantic options. Export only guarded the root revision,
so a changed child could silently yield a different Canvas. Preview did not
revalidate children after asynchronous output-file lookup/budget fitting.

## Implementation

- Preserve effective projection settings (including explicit depth zero).
- Pass the selected graph fingerprint through schema, dispatcher and service;
  compare it before writing. Direct export without it intentionally derives
  a fresh map; guides prohibit dropping a conflicting preview guard.
- Share bounded final source checks across preview and export: revisions,
  scope access and moderation; unavailable-source errors disclose no paths.
- Preserve output revision checks and scope-local writes. No new tool,
  account workflow, daemon, client installation or live-server restart.
- Compact previews omit duplicate metadata/legend nodes when necessary;
  persisted JSON Canvas keeps its managed marker and revision metadata.

## Verification and limits

Five original regressions failed before the fix. Additional tests exercise
source deletion/hiding during fitting, malformed guards, exact action replay,
2048/2400/4000/12000 budgets, existing output revisions and longer paths.
The private-scope MCP test covers public URI replay, anonymous denial,
fingerprint rejection at the dispatcher, unchanged output after child drift,
and exactly five stable tools.

Astra review found the 2048-character fallback regression twice (new versus
existing output revision overhead); both cases became regression tests.
Community maps linking public Global notes are intentionally allowed; Global
maps must not include Community/private sources. This policy is unchanged.

Checks remain optimistic: they do not prevent external writers from changing
files after final validation. The fingerprint covers the selected graph, not
an atomic census of every omitted candidate or unrelated Vault file. Extremely
long paths may still exceed the minimum budget and fail explicitly.

Verification: 16 dedicated contract tests pass. Build passes. Compiled fixed-five
MCP smoke confirms new/existing exportAction replay at a 2048-character budget
(existing preview: 1397 characters), full persisted metadata, no copied body,
child-drift rejection and unchanged output revision. Temporary fixtures removed.
The first full suite passed 1586 tests with one skip; final count-display
adjustments were followed by a fresh full-suite run before commit.
