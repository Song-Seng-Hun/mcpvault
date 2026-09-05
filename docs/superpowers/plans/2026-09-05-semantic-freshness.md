# Semantic read and reconciliation integrity

Inline TDD/debugging/verification; no new agents, no live Vault changes, fork main only.

## Requirements

- Vector rows/results are advisory. Hydrate bounded selected rows against current
  source hash and moderation on every return, including cached-query hits.
  Keep exact revision hashes privately even when the caller omits revisions.
- Drain delivered catalog events before cache selection. A changed query generation
  must not stamp an old computation as new. Storage/backend failure yields bounded
  path-free semantic unavailability, never crashes lexical/MCP or certifies empty
  knowledge. Preserve the existing cooldown rather than starting a retry loop.
- Scans distinguish absent paths from IO/permission errors and never infer deletes
  from a partial unreadable inventory. Preserve pending work on a failed scan.
- Pending delete/upsert intents are not authoritative existence checks. Recheck
  current files and Vault root before applying deletes; a recreated file must be
  reindexed, and an upsert for a now-deleted file must not retry forever.
- Use real temporary Markdown and controlled IO/native-vector adapter doubles;
  do not download an embedding model or install anything. Test public outcomes,
  cache generations, worker deletion decisions and retry preservation.
- Build, full tests, compiled smoke, docs/policy as needed, diff review, source/dist
  commit and verified fork push. No upstream PR or server restart.

## Boundaries to retain

No atomic filesystem transaction or exhaustive global vector census is claimed.
Vector row line locators, cross-process manifest refresh, global operational
counts, scope-table partitioning, transactional multi-table writes and standalone
graph/Canvas projections need separate evidence. Do not mark the whole goal done.

## Implementation and verification

- Candidate-only query caching rehydrates current source hashes/moderation and
  checks generation drift after hydration. Delivered catalog events are drained
  before selecting cached candidates. Scope/path checks precede source reads.
- Real temporary-file regressions reproduce cached edits/deletes/hidden notes,
  traversal into private scopes, failed inventory IO, recreated deletes, absent
  upserts, missing Vault roots, saturated queues and edits during embedding.
  Controlled vector-adapter failure verifies manifest preservation and retry;
  the public MCP adapter keeps bounded lexical results on semantic failure.
- Final inline review covered source diff, the 22 new semantic tests, progressive
  retrieval policy version 19, documentation and generated output. No extra
  agents or live Vault mutations were used. No new fixed MCP tools were added.
- `npm test`: 60 files passed; 938 tests passed, 1 skipped (40.70 seconds).
  This covers the source changes; a subsequent whitespace-only indentation
  cleanup was rebuilt with `npm run build` (exit 0).
- Compiled-code smoke passed: a cached candidate disappears after an actual
  source edit; a forced vector-backend failure leaves public MCP lexical search
  working within 512 characters, without driver/path error disclosure.
- `git diff --check` passed. This batch does not verify actual model relevance,
  atomic filesystem/vector transactions or exhaustive orphan-row cleanup.
  Cross-process manifest freshness, snapshot decompression limits, exact line
  locators and other storage/view audits remain on the organization roadmap.
