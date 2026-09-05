# Composition review: examples, locators, and compact recovery

## Evidence and intent

Six real temporary-Vault tests failed on the baseline: backtick and tilde
examples generated false split signals, a long code sample alone was called
multi-topic, candidate locators omitted the source revision and used body
offsets, and either 512-character format discarded the first useful target.
The purpose is less unnecessary organization work, not automatic splitting.

## Implementation

- Shared physical Markdown scanner for outline and streaming paragraphs;
  matching fences/Properties are excluded, headings/fence gaps break paragraphs.
- Read eligible sources from metadata pages, validating visibility/revision,
  rather than retaining full body pages. Carry exact source revision and
  physical line basis; verify selected sources again before returning.
- Score long prose rather than code volume. Counts remain advisory and do not
  prove independent claims. Preserve the source body and all authored links.
- Use existing organization queue packing including pretty format in the
  dispatcher. Preserve leading identity/read action or a same-query retry.
- Correct the roadmap's stale next-action/dashboard budget open-item record
  after checking current code and its 25 passing tests.

## Verification

- Initial six regressions pass after the repair. Expanded composition/parser
  tests: 13 pass, including metadata-to-body drift, final revision changes,
  physical paragraph boundaries, and private/hidden filtering.
- Astra identified the already-hidden metadata case also reproduced by the
  new test: it aborted the list rather than excluding the hidden note. Fixed
  by skipping initially hidden metadata while retaining detection of newly
  hidden sources. Reviewer closed; no other actionable finding was reported.
- Fresh build passed. Full suite: 1501 passed, 1 skipped, 112 files (81.80s).
- Compiled dynamic MCP verified the fixed five-tool surface, code/hidden
  exclusions, exact revision-guarded physical paragraph reads, and current
  source recovery at 512 characters in both compact/pretty formats. The owned
  temporary Vault was removed; no live Vault changes or new setup required.
