# Consistent live context projections

## Evidence

Ten real-fixture regressions failed on the baseline: answer packets returned
root/neighbor projections after modification, hiding, or deletion; an old
neighborhood role was combined with a changed neighbor body; context packs
returned root/MOC entries changed after packet creation; and an authorized
private neighbor was silently dropped because its scope URI reached a physical
read without resolution.

## Repair

- Resolve authorized neighbor scope URIs before projection reads and require
  the neighborhood's captured revision before combining role and body. A
  selected source becoming unavailable fails with generic retry guidance.
- Share one final revision-only validator over previously visible projections.
  Resolve scope paths, reject conflicting snapshots of one identity, enforce
  access before/after reads, deduplicate, and process at most 32 distinct source
  notes in batches of four. The existing raw UTF-8 hash path avoids reparsing.
- Answer packets recheck source and selected neighbors; context packs recheck
  the root, MOC entries and packet snapshots, including copies retained in
  reasoning/synthesis fields after display rows were trimmed.
- No additional MCP tools, installation, cache, or mutation. These are observed
  drift guards for returned live note snapshots, not an atomic Vault snapshot
  or a freshness certification for every inferred graph edge, semantic model,
  historical evidence locator, or source-work aggregate.

## Validation

- Ten initial red regressions pass; related MOC tests pass (23 targeted tests).
- A positive 12-entry map checks deduplication, concurrency <=4, unchanged
  authored order, bounded output, and unrelated concurrent edits.
- Astra found a compact-read regression caused by the existing 160-character
  root-path truncation. Two real-file tests reproduced it; minimal answer
  output now keeps the canonical root identity and removes optional synthesis
  guidance first if needed, or explicitly asks for a larger budget.
- A further red test showed budget-removed supporting rows were labeled
  truncated:false. Budget trimming now sets the flag and counts the flag itself
  in the serialized-size check. All 14 targeted context tests pass.
- Initial full suite: 1457 passed, 1 skipped. Compiled MCP verified stable
  answer/context reads and rejection of a mid-read hidden neighbor without
  disclosing its marker, with five tools. Owned fixture removed; reviewer closed.
- Final build passed; full suite: 1460 passed, 1 skipped, 109 files (75.73s).
  Updated compiled MCP smoke preserved an exact 180-character root in answer
  and context packets at maxChars=1024, and verified truthful row-trimming
  flags within the requested budget. Five tools remain; owned fixture removed.
  Final diff check passed. No live Vault data or client settings were changed.
