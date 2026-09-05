# Consistent bounded note projections

Use inline TDD, debugging, review and verification. No agents, live Vault writes,
new MCP tools, client setup or upstream changes.

## Root cause and design

`get_note_outline` and `read_note_lines` currently call `readNote` for moderation
and revision, then independently read the file for headings/body. An intervening
edit can attach revision A to body B or check public state A while returning
hidden state B. ParsedNote already retains `originalContent`, so do not add a
second snapshot store or read/retry loop. Share pure outline/line projection
functions between the filesystem methods and MCP adapters; the adapter derives
its bounded view from exactly the raw content whose revision/visibility it checked.

Existing filesystem signatures and fence-aware parsing remain compatible. Path
normalization, filtering, symlink checks and scopes stay in the existing read
boundary. Projection helpers have no filesystem or authorization side effects.
This guarantees internally coherent replies, not latest-at-return semantics or
a transaction spanning a later edit. expectedRevision remains required for writes.

## Verification work

- Reproduce real-file edits after readNote returns: line/outline content and
  revision must remain from the same initial snapshot, including hidden/public
  transitions; no data from a denied second snapshot may leak.
- Extract existing fence-aware outline and line-window algorithms; keep their
  filesystem tests, clamp behavior and raw physical lines unchanged.
- Test public five-tool call_endpoint routes with returned revisions/budgets,
  then re-read current content to prove the concurrent edit was real.
- Run targeted tests, build, full tests and compiled MCP race smoke. Update
  contracts, review diffs, commit source/dist/docs and verify approved fork push.

## Implementation and evidence

The four initial public-MCP regressions failed as intended: both line and outline
routes returned Concurrent content with Original's hash, and both exposed a new
HiddenPrivateMarker after a public precheck. The adapters now project directly
from the already-checked ParsedNote.originalContent. Two additional reverse
transition cases confirm that a hidden snapshot is denied even if the file is
published immediately afterward; the next read can observe the public revision.

Pure helpers in `note-projections.ts` preserve the existing filesystem interfaces,
heading/fence parser and exact clamped-window metadata. No new filesystem read,
permission bypass or MCP endpoint was introduced. Public tool descriptions and
policy version 21 explain snapshot consistency and revision comparison across
continuations. An automatic revision-pinned cursor protocol remains open: this
change does not make a sequence of separate requests atomic.

Targeted tests: 242 passed, 1 skipped. Full `npm test`: 64 files passed,
1,000 tests passed and 1 skipped in 41.90 seconds. `npm run build` and
`git diff --check` passed. Compiled MCP smoke reproduced real intervening writes
for both routes, verified the old snapshot body/hash stayed paired within 512
characters, then confirmed the next request denied the new hidden revision.
Inline review covered scope/path read boundaries, shared parser equivalence,
response budgets and the absence of originalContent in public responses.
