# Archive reference diversity implementation plan

> Execute inline with executing-plans and TDD. No new agents, live Vault mutations or upstream contribution.

**Goal:** Rediscovery should show why different current documents still use an archive, not spend all four previews on repeated links from one document.

**Architecture:** Reuse the existing graph query once per candidate, with a bounded 64-link internal probe. Freshly validate each distinct source path/revision, then retain the first valid occurrence for at most four distinct documents. Keep the final source revision check. Ranking remains advisory raw link occurrences; distinct previews are not independent evidence or votes.

**Tech stack:** Existing TypeScript Wiki/filesystem services and Vitest.

## Design

Returning only the first four occurrences can hide other uses; scanning all backlinks would defeat context/resource bounds. Choose a 64-link probe, four distinct-source samples, and an explicit `referenceScanTruncated` signal when the graph has more links. A `referencesNextAction` uses the existing `mcp.get_backlinks` with public target path and offset 64, never a new tool or invented clipped identifier. It is optional exploration of current backlinks, not a source snapshot continuation.

The target revision must match the current archive. Current source metadata is read only once per distinct probed path; changed/hidden/missing sources never get an old excerpt relabelled with a new revision. Apply all existing caller scope and moderation checks; final candidate/source hydration checks remain. Responses still obey existing complete-JSON budgets; small candidate projections can omit reference detail and route through their existing exact note read.

This intentionally improves sample usefulness, not whole-vault scan cost, global ranking or automatic restoration. Metadata counting remains full-inventory and the archive scan cursor remains window-local.

## Steps

- [x] Add real-file regressions to `src/archive-rediscovery.test.ts` for repeated-link diversity, stale first-author fallback, 64-link cap and exact scope-local follow-up. Confirm baseline failures.
- [x] Modify `resurfaceArchivedKnowledge` in `src/llm-wiki.ts` to probe 64 links, deduplicate before fresh hydration, keep four revision-matching source previews and publish bounded continuation metadata.
- [x] Update dynamic description in `src/llm-wiki-tools.ts`, README, schema and roadmap. Run archive/public budget/security tests, build, full suite and `git diff --check`.
- [x] Exercise compiled MCP on an isolated Vault and follow `referencesNextAction`.

Delivery uses a source/dist/docs/tests commit and authorized fork-main push;
the Git command result and matching remote SHA are the delivery evidence.

## Verification / inline review

- Four initial tests reproduced repeated-source crowding, stale first-source
  false negatives and the missing capped reference probe.
- A further regression reproduced empty `truncated:false` output when all
  sampled references were stale despite remaining unprobed links. Incompleteness
  and one revalidated inspection route now survive an empty sample.
- Final-target hidden/edited/deleted regressions reproduced stale rows left
  beside a suppressed follow-up. Known-invalid rows are now removed too.
- Archive suite: 50 passed. Build and whitespace validation passed. Final full
  suite: 1176 passed, 1 skipped, 84 files, 66.03 seconds.
- Compiled MCP fixture: 80 occurrences from one source yield one preview;
  the returned offset-64 backlink action successfully reaches a later source.
  Exactly five fixed tools remain. Temporary fixture removed; no live writes.
- Inline review covered scope projection, current source/target revisions,
  bounded samples/JSON and explicit non-global-ranking semantics. No new agent
  or independent evidence claim. Whole-inventory scale work remains open.
