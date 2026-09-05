# MOC Markdown identity parity

## Evidence and requirement

Learning and graph-health projections still requested wikilink-style
preferRelative behavior for ordinary Markdown body links. Four failing
fixtures proved that both selected a nearer wrong path for a root-qualified
Markdown link, and silently replaced a missing sibling with a remote basename
or alias. These derived views must agree with filesystem/graph/reference
resolution rather than inventing a different reading path or coverage report.

## Implementation

The two consumers now select the existing shared resolver's Markdown syntax.
No new resolver, client setup, tool, or storage model. Root-qualified paths,
explicit ./ and ../ paths, sibling file names and wikilink aliases retain the
existing public contract; typed Properties retain their existing semantics.

## Validation

- Four original red regressions now pass; alias case uses angle-bracket
  Markdown destination syntax so the parser actually exercises the alias.
- Explicit relative files, heading/block locators, wikilink aliases and fenced
  examples retain their behavior.
- Nested MOC traversal and root relocation preserve the intended file list.
- Hidden files are not exposed or replaced with visible aliases, and a
  1024-character learning view remains bounded.
- Targeted new MOC plus continuity suites: 12 passed. Build passed.
- Full suite: 1388 passed, 1 skipped, 104 files (70.65 seconds).
- Compiled MCP transport smoke verified the fixed five-tool surface and
  dynamic call_endpoint learning-path/graph-health agreement. Temporary
  fixture Vault and account removed afterward.
- Luna reviewed the two consumer changes and shared resolver; no concrete
  correctness issues reported. Reviewer closed. Final diff check passed.

No live Vault notes or server configuration modified.
