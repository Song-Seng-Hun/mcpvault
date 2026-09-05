# Current actionable exception board implementation plan

> Execute inline with executing-plans and test-driven-development. No new agents. The user already authorizes autonomous improvements and fork-only main delivery.

**Goal:** Repair the existing 5S exception board as a bounded, deduplicated, revision-aware next-action queue without another task database.

**Architecture:** Keep the five-tool surface and existing endpoint/schema. Existing organization/Canvas health provide candidate signals, not global truth. Validate candidate visibility and current source revisions; pack a narrow allowlisted item contract in `src/exception-board.ts`. Never copy source-view bodies, arbitrary nested fields, or free-form error details into the aggregate.

**Tech Stack:** TypeScript, existing Markdown/Canvas services, Vitest temporary Vaults, in-memory MCP, committed dist.

## Design and alternatives

Count-only truncation cannot guarantee JSON budgets. A second independent lint pipeline would duplicate rules and drift. Use existing child views with an explicit partial-candidate count and typed bounded projection. Details can be read through the returned exact safe action rather than loading every child dashboard. Child truncation must not mean the Vault is healthy.

- Deduplicate path/code before counting and selection; validation errors retain priority. Counts/total refer to validated unique candidates, not a Vault census.
- Stamp lint findings with the revision of their captured source, not a later re-read; retain it in quarantine. Revalidate visible source metadata with fresh/strict reads. Omit changed, deleted, or moderation-hidden candidates before counts and output. Missing old snapshot provenance must be labeled recheck-required, never falsely current.
- On a missing/changed owner, evict only this caller/limit's cached lint result so a subsequent board call can recompute it. Do not repeatedly discard the same stale cache indefinitely or add another full scan to this response.
- Cross-note predicates remain advisory even if their owner revision matches. Read the exact note, argument map, or learning path before revision-safe repair. Do not certify every dependency from the owner's hash.
- For Canvas findings, re-read the guarded file and compare its captured revision. Keep invalid JSON as an unverified finding with the supported Canvas-health action, not unsupported notes.read on a Canvas. Never forward a hidden root path or arbitrary child action.
- Never echo child free-form errors, nested fields, recommendations, private reference names, or credentials. Use finite categories, bounded code identifiers and static repair explanations; preserve exact authorized target paths and revisions.
- Bound the entire JSON at 512–16000 characters. Prefer one usable exact action over descriptive prose; if a selected target cannot fit, return a same-request retry with maxChars 16000. Do not silently choose an unrelated shorter target or truncate identities.
- Detailed report retains all selected items when possible; compact report drops optional prose then tail items. Signal truncation and the partial count scope. No automatic mutations, publication gates, index installation, or new service.

## Tasks

- [x] Add `src/exception-board.test.ts`: real temporary Vaults for minimum/max budgets, long paths, duplicate counts, error priority, authorized private paths, hidden/deleted/changed sources, cached stale lint, true IO errors, and invalid Canvas routing. Inject a child-view race only at the aggregation boundary, preserving real filesystem reads.
- [x] Observe red tests with `npm test -- src/exception-board.test.ts` before production changes.
- [x] Add source revision provenance in `WikiLintIssue`/`computeLint` and quarantine; capture `QueryNote.revision` in the already-retained classification list, then stamp selected findings in one pass (no second full inventory or unbounded revision map).
- [x] Implement `src/exception-board.ts` for narrow item types, deduplication, ranking, partial counts, and whole-JSON packing. Update `LlmWikiService.exceptionBoard` for validated source selection and safe actions.

```ts
expect(JSON.stringify(board).length).toBeLessThanOrEqual(512);
expect(board.countScope).toBe('validated_candidates');
expect(board.total).toBe(new Set(board.items.map(item => `${item.path}|${item.code}`)).size);
// A captured source revision differing from a fresh one must not become a repair target.
```

- [x] Through `call_endpoint`, test the five-tool surface, pretty-printed 512-character report and execute its returned action; ensure the private physical path never leaks.
- [x] Update existing endpoint description, lazy maintenance policy, README/schema and roadmap with counts, truncation, provenance, and retry semantics. Keep welcome unchanged.
- [x] Run targeted suites, `npm run build`, full `npm test`, `git diff --check`; review final source and generated output. Publication remains a separate gate: commit and push only the user fork main, then verify the actual remote hash before reporting delivery.

## Scope limits

This aggregate is not an atomic multi-note snapshot or exhaustive scan; child views may be bounded/cached. It does not replace a current evidence review. Separate child-view hygiene and large-Vault inventory measurements remain explicit follow-up audits, not claims of whole-goal completion.

## Verification record (2026-09-05)

- Initial regressions reproduced 512-character requests returning 1390 characters, hidden owner disclosure, missing current source guards/actions, unsupported Canvas read routing, and arbitrary child-detail forwarding. An explicit duplicate fixture reproduced total 4 for 3 unique findings.
- A second-call cache regression failed before scoped stale-cache eviction, then passed; the next call now recomputes instead of repeatedly dropping the old source snapshot.
- Final dedicated board suite: 17 cases. Combined board/MCP/policy/LlmWiki suites: 156 passed. The in-memory public MCP test executes the returned private notes.read action and matches its revision within a 512-character prettyPrint request.
- Final build: exit 0. Full suite after explicit response types: 55 files, 847 passed, 1 existing platform skip (848 total), exit 0. git diff --check: exit 0.
- Reviewed source and generated declarations: optional detailed fields and same-request retry are represented explicitly; no fixed MCP tool or write endpoint was added. The welcome remains unchanged.
- Original lint/organization-health and Canvas child-view hygiene require separate direct-interface audits. The board's allowlisted projection is not evidence that all underlying independently callable views are safe, current, or wholly budgeted. These gaps and archive scale measurements remain in the roadmap; the full goal is not complete.
