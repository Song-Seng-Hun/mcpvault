# Navigation identity, scope, and output bounds

## Reproduced gaps

Ten baseline tests failed. Neighborhood/trail resolved Markdown links as
source-less wikilinks, selected multiple ambiguous candidates as definite
edges, and trail stripped explicit .md extensions. Both could traverse a
model-to-agent relationship disallowed by the source's scope despite the
caller owning both identities. One-shot response halving exceeded maxChars:
a 512-character neighborhood request returned 6160 characters; a single trail
with long paths/context returned 1194.

## Repair

- Reuse shared filesystem Markdown/wikilink resolution with the current source
  path, exact extensions, and source-to-target scope predicate for both views.
  Only unique resolutions become direct edges; no arbitrary candidate subset.
- Neighborhood applies its source scope to candidates. Backlink authors are
  direction-checked separately from the graph resolver's target visibility;
  each backlink is uniquely re-resolved from that author's own source scope.
  Hidden metadata cannot populate shared-facet rows.
  Reject hidden roots, including zero-hop trail endpoints.
- Preserve bounded unresolved/ambiguous direct-link counts for diagnosis;
  graph truncation remains explicit. Trail also propagates truncated link scans.
- Budget packing removes complete neighbor/path rows until the serialized
  result fits, then drops optional source metadata. Preserve canonical endpoint
  paths/revisions, or request a larger budget if identity itself cannot fit.

No new endpoints or setup. These are bounded navigation projections, not a
whole-Vault census, atomic snapshot, or proof of a semantic relationship.

## Verification

- Ten initial failures now pass; 37 related navigation/context/MOC tests pass.
- Positive coverage verifies root/relative Markdown, Obsidian note embeds,
  aliases, typed Properties and their backlinks, plus hidden zero-hop roots.
- Astra identified ambiguous backlinks and a reverse-filter-induced false
  resolution. Both were reproduced red and fixed; the formerly false backlink
  case also becomes valid after repairing its alias. Reviewer closed.
- Expanded targeted navigation/context/MOC suites: 42 passed. Initial full
  suite: 1473 passed, 1 skipped. Final build passed; final full suite: 1475
  passed, 1 skipped, 110 files (70.09 seconds).
- Compiled dynamic MCP smoke verified the exact Markdown sibling, no false
  trail to a remote namesake, no ambiguous backlink, and a 512-character
  neighborhood budget with long metadata. Five tools remain. The owned
  temporary Vault was removed; final diff check passed. No live Vault data or
  client settings were changed.
