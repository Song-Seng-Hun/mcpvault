# Archive rediscovery implementation plan

> **For agentic workers:** Use executing-plans for inline implementation. Preserve unrelated changes and publish only to the user's fork.

**Goal:** Make the existing archive rediscovery endpoint safe, bounded, current, and able to inspect later archive windows without restoring anything.

**Architecture:** Extend `LlmWikiService.resurfaceArchivedKnowledge` and its existing adapter/schema, not the fixed MCP tool list. Markdown/revisions remain authoritative. Reuse fresh metadata, replacement validation, and guarded backlinks. Keep at most 200 probe records and the requested top recommendations. Window progression is a path-ordered scan, not a global ranking or a stable snapshot under concurrent edits.

**Tech Stack:** TypeScript, existing Node filesystem services, Vitest, generated committed dist.

## Contract

- Add optional `afterPath` (maximum 1024 characters). Resolve it through scope access and validate it as a relative path before comparing it with physical paths. A cursor does not grant access.
- Keep `totalInactive` as the count of visible inactive notes in the scan; ignore hidden records before counting and probing.
- Probe the first bounded inactive window strictly after `afterPath`. Retain existing link-count ordering inside this window.
- Return `nextScan: { endpointId: 'wiki.resurface_archives', arguments: { afterPath, limit, maxChars } }` when later inactive notes remain. Explicitly distinguish scan continuation from omitted lower-ranked recommendations in the current window.
- Re-read candidate metadata after discovery; never combine an old lifecycle/title with a newer revision. A note reactivated, hidden, or deleted while probing is omitted. Genuine storage failures are not silent disappearance.
- Revalidate source and replacement revisions. Reference previews have their source revision; discard changed/hidden/deleted preview sources rather than disclose stale context. Never restore, move, delete, or archive a note.
- Bound the entire JSON response, not only items. Prefer a small exact note read and next-scan action; if exact continuation paths cannot fit, return a bounded retry of the same request with a larger budget. Never truncate a path into a different target.

## Steps

- [x] Add `src/archive-rediscovery.test.ts` fixtures for hidden counts, current lifecycle/revisions, raw-storage errors, full response budgets, private scopes, replacement visibility, and a referenced archive beyond the first probe window.
- [x] Run `npm test -- src/archive-rediscovery.test.ts` and verify the failures correspond to the missing contracts.
- [x] Implement the service window and current-state checks in `src/llm-wiki.ts`; update `resurface_wiki_archives` in `src/llm-wiki-tools.ts` and its `src/createServer.ts` dispatch to forward `afterPath`.
- [x] Exercise the public adapter using `call_endpoint` with `endpointId: 'wiki.resurface_archives'` and then exactly the returned `nextScan.arguments`. Check that its original caller identity is reused normally, never echoed as an access token.
- [x] Document window ordering, truncated recommendation meaning, and restart-after-edits semantics in README/schema. Preserve all existing read-only and scope rules.
- [x] Run targeted tests, `npm run build`, full `npm test`, and `git diff --check`; regenerate the committed dist output.

Publication gate: commit/push only the user's fork main and compare local/remote hashes after publishing. The delivery response records that evidence; this pre-commit document does not preclaim publication.

## Verification and implementation findings

- The first 22 regression tests failed against the original implementation. Subsequent red tests caught natural cursor ordering, budget-omission flags, obsolete target aliases, absolute-path compatibility, serial freshness IO, repeated whole-graph scans, and hashing once per link rather than once per source.
- `src/archive-rediscovery.test.ts` now covers 41 cases. The public adapter also exercises authorized scope continuation and pretty-print budgets through the fixed executor.
- `npm run build` passed. Full `npm test`: 53 files passed, 791 tests passed, one existing skip. `git -c core.safecrlf=false diff --check` passed.
- Fresh inventory checks now overlap at most eight reads while preserving inventory order. A lazy reverse-link view is scoped to the access predicate and graph generation; more than 16,384 resolved edges triggers the complete fallback scan, never partial counts. Matching source access/moderation remains freshly checked. Generation changes discard the old view.
- Parsed source and target revisions are optional internal backlink metadata; ordinary backlink responses remain unchanged. The archive projection validates both before using previews and revalidates selected note/replacement/source revisions before returning.
- Full-suite parallel runs exposed a five-second timeout in the new 201-file integration fixture. This case now uses the deployed metadata-plus-graph configuration, bounded parallel fixture writes, and an explicit 15-second integration timeout. Its data size, both scan calls, and assertions are unchanged; this is not a five-second latency SLA or a throughput benchmark. Deterministic fanout, source-hash count, reverse-view reuse, and overflow tests cover the introduced optimizations independently.
- Inventory counting still scans current metadata, and recommendations rank only inside one scan window. No global ranking, atomic cross-file snapshot, or exact freshness of every indexed incoming-link count is claimed.

## Scope exclusions

No background worker, new persistent cursor store, credential changes, new fixed MCP tool, upstream PR, real Vault writes, or automatic lifecycle transition. Atomic cross-file snapshots are not claimed; every mutation still requires a fresh read and expectedRevision.
