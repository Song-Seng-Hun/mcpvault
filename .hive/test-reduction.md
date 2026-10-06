# Test reduction candidates (ticket llm_wiki-003, step 8)

Analysis only. Nothing in kept code was deleted; each cut below needs approval.
Measured after steps 0–7 (`remove/codex-hook`, 147dcfc1a): 475 test files,
70,216 test lines (`src`, `tests`, `website-shibumi`).

Method: `git ls-files`, import reachability from `server.ts`, `src/index.ts`
and the package bins, and pattern counts per test file. Workers loaded by
path and the separate `website-shibumi` app were excluded from the
reachability check. `scripts/` users count as real users.

## Cut list

Risk: **low** = no production behavior loses coverage; **medium** = the
same behavior is covered elsewhere only indirectly.

### 1. Test-only modules (delete module and test together)

These production files have no production importer. Their tests only prove
that dead code still works.

| Module (lines) | Test (lines) | Total | Risk | Note |
|---|---|---|---|---|
| `src/graphify-assertion.ts` (65) | `graphify-assertion.test.ts` (40) | 105 | low | No importer outside its test. |
| `src/skill-release-admission.ts` (133) | `skill-release-admission.test.ts` (176) | 309 | low | Test already fails in the baseline (load-flaky). |
| `src/skill-review-evidence.ts` (72) | `skill-review-evidence.test.ts` (46) | 118 | low | No importer outside its test. |
| `src/resource-bundle-host.ts` (128) | `resource-bundle.test.ts` (75) | 203 | medium | The test also exercises `document-resource`; keep a short case there if the host goes. |

Not candidates: `guidance-sync.ts` (used by `guidance-host.ts`),
`skill-library.ts` (used by `scripts/skill-library-host.ts`), and
`scripts/guidance-source.ts` (used by `scripts/guidance-build.ts`).

### 2. Duplicate coverage: MCP tool-count assertion

39 test files repeat `expect((await client.listTools()).tools).toHaveLength(N)`.
The fixed tool surface is already asserted with exact names in
`createServer.test.ts` ("server exposes control and direct recording tools")
and `record-tool-surface.test.ts`. Every removal or added tool forces a
39-file edit, as steps 4 and 7 showed.

- Cut: the one-line count in 36 files. Keep it in `createServer.test.ts`,
  plus `protocol-version.test.ts`, `compilation-local-cli.test.ts` and
  `http-only-process.test.ts`, which check the built `dist/` (still 16
  tools until it is rebuilt).
- About 36 lines. Risk: low.

## Review list (rewrite or trim, not a plain cut)

### 3. Tests of internals

These reach private members through `(x as any).method(`. They break on
refactors without a behavior change. They guard race and permission
behavior, so rewrite them through the public API rather than delete.

| File | private calls | lines | Risk if cut |
|---|---|---|---|
| `semantic-reuse.test.ts` | 33 | 338 | high |
| `semantic-integrity.test.ts` | 21 | 439 | high |
| `shared-index-storage.test.ts` | 18 | 240 | high |
| `cache-work-budget.test.ts` | 12 | 42 | medium |
| `document-policy-store.test.ts` | 11 | 77 | medium |
| `compilation-service.test.ts` | 7 | 706 | medium |
| `publication-staging.test.ts` | 6 | 88 | medium |

### 4. Tests of strings and prose

These assert literal guidance or document text (`toContain`/`toMatch` on
literals of 12+ characters). Prose edits fail them even when behavior is
unchanged.

| File | literal assertions | lines | Suggestion | Risk |
|---|---|---|---|---|
| `instruction-budget.test.ts` | 44 | 113 | Keep budget limits; drop wording checks against plugin docs. | medium |
| `manual-context-budget.test.ts` | — | 105 | Byte-for-byte prose inventory; already fails in the baseline. Retire it with its 46 KB fixture. | medium |
| `wiki-policy.test.ts` | 62 | 218 | Keep route/topic/version checks; drop sentence matches. | medium |
| `llm-wiki.test.ts` | 66 | 4,668 | Trim schema-text checks only; most assertions are behavioral. | medium |
| `organization.test.ts` | 33 | 704 | Mostly error-message checks; low gain. | high |
| `filesystem.test.ts` | 76 | 3,322 | Mostly security error messages; keep. | high |

### 5. Snapshot and fixture bloat

There are no Vitest snapshots (`toMatchSnapshot` count is 0). The bulk is in
JSON/TS fixtures:

| Fixture | Size |
|---|---|
| `tests/fixtures/retrieval-routing-v1.json` | 139 KB |
| `tests/fixtures/context-economy-v1.json` | 83 KB |
| `tests/fixtures/question-graph-corpus.ts` | 46 KB |
| `tests/fixtures/manual-context-originals.json` | 46 KB (only for `manual-context-budget`) |
| `tests/fixtures/context-architecture-v1.ts` | 24 KB |

These are evaluation corpora, not snapshots. Only the manual-context fixture
is a cut candidate (with item 4).

### 6. Overlapping families (consolidation review)

Same-shape tests spread across many files. Each covers a different endpoint,
so cutting is risky. Consolidating them into table-driven tests could save
lines without losing cases.

| Family | files | lines |
|---|---|---|
| `*-budget` (bounded output fits `maxChars`) | 17 | 1,698 |
| `*-snapshot*` consistency | 13 | 2,045 |
| `*-date-integrity` / `work-timing-integrity` | 6 | 786 |

## To rewrite (coverage lost during removal, not a cut)

`src/owner-activity-mcp.test.ts` (336 lines) was deleted in step 4 because
every case drove the removed `collaboration` activity through
`community.posts`/`community.post`. The owner-consent mechanism is still
live for `skill-evolution`, and these MCP-level barriers now have **no**
end-to-end test. Rewrite them on skill endpoints (`skill.resolve`,
`skill.candidate`), which needs a skill-evolution fixture:

1. A selected optional activity defaults to no owner consent; request labels cannot forge consent.
2. The catalog hides active optional endpoints but exposes exact locked schemas.
3. Catalog consent becomes ready when granted, and revocation invalidates an active cursor.
4. The catalog cursor fingerprints the available overlapping grant set without exposing grant IDs.
5. Every optional activity is gated before an unavailable provider or store is touched.
6. A discovery grant filters candidates before titles and counts are produced.
7. An ancestor-shaped existing file is never readable through traversal admission.
8. Revocation after a read rejects buffered output before emit.
9. Dispatch performs a synchronous owner barrier after the final asynchronous refresh.
10. The catalog performs the same barrier, keeps its validator through the document-policy refresh, and refreshes file-backed consent at final emission.
11. Pulse performs the same three barriers (refresh barrier, retained lease validator, file-backed refresh at emission).
12. An exact-path grant permits the scoped Windows write boundary; revocation just before a physical write leaves no mutation.
13. REST uses the same owner-activity consent boundary.
14. Pulse without consent does not browse or recommend optional activity, and it revalidates its bound grant after optional reads.

Also lost in step 4: the explicit additional owner-policy cases in
`mcp-http-auth0.test.ts` (path restriction and revocation over OAuth). The
OAuth research grant now grants no owner activity, so its replacement test
should assert the denial plus the execution binding (partly covered in
`auth0-resource.test.ts`).

Unit coverage that remains: `owner-activity.test.ts`,
`owner-activity-runtime.test.ts`, `owner-activity-host.test.ts`, and the
pulse lease tests in `agent-pulse-stages.test.ts` and
`skill-evolution-pulse.test.ts`.

## Totals

| Group | Lines | Approval needed |
|---|---|---|
| Cut list (items 1–2) | ~771 (prod 398 + test 373) | yes |
| Review list (items 3–6) | ~6,100 touched if rewritten | yes, per file |
| To rewrite | ~336 lines lost; rewrite size unknown | yes |

## Applied (ticket llm_wiki-004)

- `tests/cut-list` (9d8f51622): deleted `graphify-assertion`,
  `skill-release-admission` and `skill-review-evidence` with their tests, and
  removed the repeated tool-count line from 37 files. Delta: prod −267,
  test −298, generated −45.
- **Correction:** `resource-bundle-host.ts` was wrongly listed as test-only.
  `scripts/resource-bundle-host.ts` uses it, and its test guards immutable
  originals and the bundle hash check, so it was kept.
- `tests/owner-consent-rewrite` (d92475569): `src/owner-consent-mcp.test.ts`
  (17 tests, 238 lines) re-covers the "to rewrite" barriers on skill
  endpoints. Folded or dropped: the request-label forgery case (the skill
  schemas reject extra arguments first), the pulse lease-validator
  proxy case (the microtask barrier test covers the same emit-time check),
  and the OAuth explicit-policy cases (`auth0-resource.test.ts` asserts the
  denial).
- Finding: `skill.experience` writes its request receipt under
  `Community/Skills/<id>/_evolution/receipts/` before the final consent
  barrier. A request revoked at that barrier leaves the receipt but no
  experience. Production fix is outside this ticket.

## Proposal 2 (review list, not applied)

Each group lists the files, their lines, what still covers the behavior after
a cut, the risk, and a recommendation. "Lines" counts test lines only, unless
fixtures are named.

### P2-1. Benchmark-script tests — low risk

| File | Lines | Covers |
|---|---|---|
| `backlink-cache-benchmark.test.ts` | 18 | `scripts/benchmark-backlink-cache.mjs` |
| `graph-index-benchmark.test.ts` | 35 | `scripts/benchmark-graph-index.mjs` |

- After cut: the backlink and graph index behavior stays covered by the 19
  `graph-*` test files and the backlink tests. The benchmark scripts stay
  usable by hand.
- Both refuse to run below 2.3 GiB free memory and fail in the baseline.
- Recommendation: **delete** (53 lines).

### P2-2. Prose and document-wording tests — low to medium risk

| File | Lines | Literal assertions |
|---|---|---|
| `manual-context-budget.test.ts` + `tests/fixtures/manual-context-originals.json` | 105 + 37 (46 KB) | byte-for-byte doc inventory |
| `instruction-budget.test.ts` | 112 | 47 |
| `wiki-policy.test.ts` | 217 | 62 |

- `manual-context-budget` fails in the baseline and only pins old doc
  wording. After cut, nothing checks those docs, which is acceptable because
  the docs are reference text, not behavior. **Delete** (142 lines). Risk
  low.
- `instruction-budget`: keep the size and budget limits and drop the
  sentence checks against plugin docs. **Trim about 47 lines.** Risk medium,
  because doc drift would no longer be caught.
- `wiki-policy`: keep the topic, route, version and budget checks, and drop
  the sentence matches. `wiki-policy-contract.test.ts` still proves every
  route resolves. **Trim about 62 lines.** Risk medium.

### P2-3. Duplicate integration test in `llm-wiki.test.ts` — medium risk

- `llm-wiki.test.ts:286` ("ordinary work completion requires a scope-safe
  auditable knowledge disposition", 144 lines) duplicates
  `agent-collaboration.test.ts:99` ("task completion requires a bounded
  auditable knowledge disposition", 149 lines).
- After cut, the agent-collaboration copy keeps the behavior.
- Recommendation: **delete after a line-by-line diff** confirms that no
  assertion is unique (144 lines).

### P2-4. Overlapping families — medium risk, consolidate rather than delete

| Family | Files | Lines | Estimated saving |
|---|---|---|---|
| `*-budget` (bounded output fits `maxChars`) | 17 | 1,698 | ~680 with one table-driven harness per endpoint shape |
| `*-date-integrity` / `work-timing-integrity` | 6 | 786 | ~300 by sharing a malformed-date fixture |

- After consolidation, every endpoint and date field keeps one case, so the
  coverage stays the same.
- The risk is in the rewrite itself (a dropped case).
- Recommendation: **consolidate** in a later ticket, one family per commit.

### P2-5. Tests of internals — keep for now, rewrite small ones

| File | Lines | Recommendation | Risk if cut |
|---|---|---|---|
| `semantic-reuse.test.ts` | 337 | keep | high |
| `semantic-integrity.test.ts` | 438 | keep | high |
| `shared-index-storage.test.ts` | 239 | keep | high |
| `cache-work-budget.test.ts` | 41 | rewrite through the public API | medium |
| `document-policy-store.test.ts` | 76 | rewrite through the public API | medium |
| `publication-staging.test.ts` | 87 | keep | medium |

These guard revocation races and private storage. Nothing else covers those
paths, so deleting them would remove the only check.

### P2-6. Large corpora and snapshots — keep

- Snapshot-consistency family: 13 files, 2,045 lines. Each file covers a
  different snapshot consumer. Risk if cut: high.
- Evaluation corpora: `retrieval-routing-corpus`, `context-economy-evaluation`,
  `context-architecture-corpus` and `question-*-corpus`, 182 test lines and
  about 330 KB of fixtures. These are the only retrieval-quality regression
  gates. Risk if cut: high.

### P2-7. Environment-dependent failures — gate them, don't delete

| File | Lines | Why it fails here |
|---|---|---|
| `portable-setup.test.ts` | 311 | Windows ACL and settings merge on this host |
| `safe-test-runner.test.ts` | 177 | memory admission, real child processes |
| `architecture-contracts.test.ts` | 77 | semantic check script |
| `skill-security-host.test.ts` | 31 | real filesystem and worker |
| `guidance-build-preflight.test.ts` | 31 | needs local `tsx` in the worktree |

- These test real behavior that only fails because of this host.
- Recommendation: **skip when the host can't run them**, with a stated
  reason, instead of deleting. That keeps the full-run baseline clean
  (about 627 lines stay).

### Proposal 2 totals

| Risk | Recommended action | Lines removed |
|---|---|---|
| Low | delete P2-1 and `manual-context-budget` (P2-2) | ~195 |
| Medium | trim P2-2, delete P2-3 after diff, consolidate P2-4 | ~1,233 (≈109 trim + 144 + ~980 consolidation) |
| High | keep P2-5 (except the two rewrites), P2-6, P2-7 (gate) | 0 (≈3,950 lines reviewed and kept) |
