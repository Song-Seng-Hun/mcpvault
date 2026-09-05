# Lint and organization-health hygiene implementation plan

> Execute inline with the previously read planning, TDD, debugging and verification skills. Do not create agents. Work in the authorized fork main.

**Goal:** Keep directly callable lint and organization health private, revision-aware and wholly response-budgeted while preserving their existing organization rules and internal commit validation.

**Architecture:** Reuse computeLint, but establish a fresh scoped visibility/revision inventory before resolving aliases/evidence. Read coherent original notes rather than combining cached Properties with freshly loaded bodies. Keep snapshot guards private in a WeakMap, validate them before returning cached or newly computed diagnostics, and discard changed caches. Public lint uses a bounded presentation wrapper; internal lint keeps complete error counts for commit validation. Organization health filters child graphs/collections through the same known-visible predicate, then revalidates its lint basis after aggregation.

**Tech Stack:** Existing filesystem/path/scope services, TypeScript, Vitest, five-tool MCP adapter, committed dist.

## Contracts and trade-offs

- Hidden owners cannot contribute titles, aliases, stable IDs, property shapes, authority/citation collisions, errors, warnings, or collection groups.
- Unknown, inaccessible, too-private, or moderation-hidden evidence is unavailable; do not read hidden evidence bodies or echo rejected target identities from diagnostics. Retain useful owner-local locator guidance.
- Existing note snapshots are guarded optimistically, not locked. A changed/missing guarded file rejects an in-progress diagnosis; stale cache hits are recomputed. Missing inventory entries/new-file discovery still depend on the filesystem inventory generation, not an atomic global census.
- A revision-checked snapshot costs fresh metadata verification across known scoped files; do not claim constant-time cache hits. Future optimization requires equivalent visibility/revision evidence rather than dropping checks.
- Public lint gains maxChars (512–16000) on its existing dynamic endpoint. Pack the whole JSON including escaping and actions. Preserve full totals/health semantics, a current exact owner/action, and truncation. Long identities use an original-arguments retry, never shortened paths.
- The existing lint endpoint is `mcp.lint_wiki`, not `wiki.lint`. The MCP integration regression exposed and corrected the presentation retry ID; no duplicate endpoint was added.
- Organization-health's existing detailed contract remains at sufficient budgets. Its final fallback keeps one actual repair finding or a retry and omits bulky child projections, not required identity/revision. The adapter must not remove all useful content to achieve a budget.
- Preserve source immutability, commit checks, existing issue codes and specific claim/learning-path routes. No auto repair, new endpoint, client installation, or global instruction expansion.

## Tasks and evidence

- [x] Create `src/lint-health-hygiene.test.ts` with real temporary Vaults: hidden owner/collision exclusion, hidden evidence rejection, cached owner and alias-owner changes, coherent note Properties/body, source IO errors, aggregate races, 512–16000 budgets and long paths.
- [x] Observe the failures before production edits (`npm test -- src/lint-health-hygiene.test.ts`).
- [x] Update `src/llm-wiki.ts`: private inventory guards, fresh coherent lint iteration, visibility before reference resolution, cache validation/recomputation, collection exclusion and optional guarded child predicates. Preserve exact internal error counts.
- [x] Add a bounded lint presentation function and organization-health final fallback. Public direct/MCP tests retain an executable exact notes.read target at minimum budgets or return a valid same-request retry.

```ts
const result = await service.lintReport(undefined, 200, 512);
expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
expect(JSON.stringify(result)).not.toContain('Hidden owner');
// After hiding an alias owner, the cached duplicate must disappear on the next call.
```

- [x] Update the existing MCP description/schema/dispatcher, README/schema, and roadmap. Record remaining directly callable child-view gaps separately.
- [x] Run targeted tests, build, full tests, diff check; review generated declarations and source changes.
- Delivery gate: commit/push only to the user fork and compare actual remote main hash before claiming delivery. Publication evidence is recorded in the task after Git succeeds, not preclaimed here.

## Verification and inline review (2026-09-05)

- Earlier red run: 10 hygiene failures; the strengthened stale-Properties case and 839-character organization output at a 512 budget also failed before their fixes.
- Current hygiene suite: 14 temporary-Vault cases including deleted cached owner and complete validation totals at internal limit zero/public limit one.
- MCP integration initially rejected the incorrectly assumed `wiki.lint` ID. Fixed the retry and test to use existing `mcp.lint_wiki`; the five-tool surface is unchanged. Both lint and organization minimum-budget next actions execute and return the diagnosed scoped owner revision.
- Strengthened the old exception-board cache test: immediate recomputation returns the current revision on the first call instead of expecting an empty result followed by a second request.
- Related suite before final guide changes: 157 tests passed. Final `npm run build` passed; generated LintReport declarations retain optional details, exact actions and retry shape.
- First full run: 862 passed, one skipped, one existing archive long-path test exceeded 5000ms (5349ms observed). Its isolated rerun passed in 1.68s. No test timeout or assertions were relaxed. Second unmodified full `npm test`: 56 files passed, 863 passed and one skipped, 49.67s. This does not establish that the intermittent filesystem timing risk is resolved.
- Inline review checked scope-private WeakMap guards, hidden evidence read rejection, true IO propagation, unchanged internal `validateCommitPaths` use of lint totals, whole escaped JSON budgets, real public endpoint IDs, source/dist parity and lazy policy version 16. No review agents were created.
- `git -c core.safecrlf=false diff --check` passed. Keep `.agents/` and `.mcpvault/` outside the commit.

## Not claimed

No complete global transaction or constant-time inventory; no whole-goal completion. Direct standalone graph/Canvas and large-inventory performance audits remain separate unless verified here.
