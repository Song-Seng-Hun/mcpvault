# Semantic raw Markdown locators

Inline TDD, debugging, verification and review; no new agents or live Vault writes.

## Design and invariants

Preserve the existing title-prefixed paragraph/chunk text and `path#ordinal`
identifiers byte-for-byte. Changing chunk text or introducing a database column
would require reembedding or a native table migration; neither is needed to fix
navigation. Extract deterministic chunk preparation into `semantic-chunks.ts`.
Map exact paragraph separators and leading trim offsets back to raw Markdown,
including Properties and CRLF. Chunk anchors are one-based physical lines and
zero-based UTF-16 character offsets; synthetic title text anchors to the first
body content (or body end for an empty body), never a invented physical line.

Hydration must verify the source hash/moderation as before, reconstruct only the
same bounded chunk layout, and resolve the exact row ID. Stored line/title/wiki
values are not authority. Unknown IDs produce no result. New indexed rows get
correct lines; old unchanged rows are repaired at read time without a reembed.
Excerpts contain bounded raw context around the real chunk start, including
continuations within very long lines. Trim excerpt text to fit a small JSON
response budget while retaining path, line, freshness and requested revision.
No changed-file snapshot consistency or nearest-neighbor recall claim is added.

## Execution and evidence

- [x] Add service regressions for old row lines with Properties, CRLF and blank
  runs; long-line excerpts; invalid IDs; 512-character result usefulness.
- [x] Add pure chunk fixtures proving raw offsets/line numbers, exact legacy
  text/ID compatibility, Unicode, empty content and the 64-chunk ceiling.
- [x] Implement the common chunk mapper and generation/hydration integration.
- [x] Run targeted tests, build, full suite, compiled raw read/locator smoke.
- [x] Update schema/README/roadmap, inline review and source/dist diff checks.

Delivery uses the approved fork main only, with an explicit commit and remote-SHA
push verification. No upstream PR, live Vault mutation, model download or extra
agent is needed.

## Evidence and integration findings

Initial service regressions returned stored line 2 instead of raw line 9 for LF
and CRLF; a forged line 8000 was trusted and unknown chunk IDs were accepted.
All now pass. Unicode window testing additionally reproduced split surrogate
pairs; bounded display slices now preserve valid pairs without changing the
legacy embedding text contract. Mixed-whitespace fixtures compare every anchor
against its raw newline count and every text/ID against the previous algorithm.

The lexical adapter had the same projection-coordinate defect. Four regressions
failed for Properties/body/empty Properties and length-changing Unicode case
folding. Text loads now retain the raw body line origin; materialization counts
newlines within the searched field. Lazy snapshot restoration recomputes this
derived origin without a persisted-format change. Restart coverage passes.

Targeted verification: 109 tests passed. Full `npm test`: 63 files passed,
993 tests passed and 1 skipped in 42.70 seconds. Build and diff checks passed.
Compiled public MCP smoke exercised both a legacy semantic row and lexical
matching against CRLF Markdown: search returned line 9 and the requested source
hash, and the line-read endpoint returned the intended paragraph within budget.

Inline final review covered compatibility, stale-source rejection, bounds and
public control-plane behavior. Policy version 20 explains physical lines and
zero/absent anchors. Semantic rows remain advisory; cross-process index freshness,
orphan reconciliation, atomic search/read/edit and full recall are separate work.
