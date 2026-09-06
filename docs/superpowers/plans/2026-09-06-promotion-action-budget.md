# Actionable promotion previews and verified source identity

## Reproduction

Mismatched post/task IDs sent inspection to `elsewhere` instead of the actual
`sample.md`. Invalid IDs also fed suggested publication paths. Long historical
source paths reduced 512-character responses to actionless counts. A report
whose compact JSON was 3431 characters became 4070 when pretty formatted.

## Contract

- Only a normalized metadata ID whose canonical managed path equals the actual
  source can select a community/task read endpoint. Otherwise remove the ID from
  the projection, mark unverified_metadata_id, and offer exact-source notes.read.
- Suggested modern Wiki target stems derive from the source basename, with a
  deterministic hash fallback for invalid/nonportable stems. Preserve expected
  missing/preflight guards; never repair metadata or write a target automatically.
- Account for final pretty formatting in collection and every response branch.
- Retain source revision and inspect action, or an explicit same-query retry
  carrying only maxChars=16000, limit=1 and prettyPrint=false overrides. Do not
  skip a long first target, lose all actions, or loop at the ceiling.
- Preserve the prior public-reference and optimistic revision validation.
- A record-specific compact fallback retains the unverified-ID marker and safe
  destination as well; if these cannot fit, use the same-query retry instead.

## Verification

Tests cover malformed/missing/mismatched IDs, canonical and nested sources,
final-format budgets, long source recovery and public MCP replay of the exact
inspection action. Update legacy tests that previously accepted dead-end output
to require recovery. Run full suite/build/compiled MCP before fork-only push.
This is not candidate pagination, automatic identity repair or collision-free
publication; the authoritative Markdown remains unchanged.
