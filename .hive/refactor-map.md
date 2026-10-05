# Refactor map — step 1 (llm_wiki-001)

Measured at `85403dc07` (2026-09-23), worktree branch `claude/llm-wiki-refactor-phase-1-6dc1e7`.
Source was not modified. Every number below comes from a read-only script run over `git ls-files`.
Analysis was regex/heuristic: TypeScript 7 ships only the native compiler, with no JS compiler API.

## 0. Baseline (start here)

| Bucket (tracked `src/**/*.ts`) | Files | Lines |
|---|---:|---:|
| Production (hand-written) | 400 | **94,714** |
| Tests (`*.test.ts`) | 572 | 84,754 |
| Generated (`src/guidance-defaults.generated.ts`) | 1 | 83,781 |
| **Total** | 973 | 263,249 |

- Upstream fork point (`c5abeda9b`, bitbonsai/mcpvault, 2026-08-26) had 23 src files with 6,626 lines (2,841 production).
  The remaining ~256k lines were added in about four weeks (`git diff --shortstat`: +256,493 / −844).
- Root entrypoints outside src: `server.ts`, `global-sync-server.ts`, `enterprise-server.ts`, `enterprise-admin.ts`,
  `economy-host.ts`, `guidance-host.ts`, `public-federation-server.ts`.
- `dist/` is committed (1,224 files) by project rule (code.md §6). It is not counted here.

**Headline:** hand-written production code has little mechanical duplication or dead code.
A realistic behavior-preserving cleanup removes **~1.7k–2.6k lines (≈2–3%)** of the 94.7k.
The only large line drop is reformatting the generated file (−78k, cosmetic).
Shrinking further means removing features, which is a product decision, not a refactor.

## 1. Module map

`src/` is almost flat: 894 of 973 files live in the root. Production lines grouped by filename prefix:

| Domain (prefix) | Files | Lines | Notes |
|---|---:|---:|---|
| `llm-wiki*` | 2 | 17,777 | `LlmWikiService` class is **15,600 lines**, with 134 methods (95 public, all wired to endpoints) |
| `createServer` | 1 | 4,219 | Control plane plus one `dispatchCore` switch with **207 `case`s** (~2,300 lines); fan-out 153 imports |
| `filesystem` | 1 | 3,864 | Vault IO, locks, move/patch/delete; 108 methods; fan-in 90 |
| skill-* | 29 | 3,308 | Skill review/release/evolution |
| story-* | 17 | 3,105 | Fiction/story features |
| document-* | 21 | 2,860 | Documents, chapters, PDF host |
| vault-* | 5 | 2,840 | Index, graph, catalog |
| enterprise-* | 9 | 2,365 | Enterprise registry/federation/server |
| work-* | 7 | 2,358 | Work projects/groups |
| roleplay-* | 16 | 2,203 | Roleplay/TRPG |
| compilation-* | 18 | 2,148 | Compilation bundles/publication |
| search, semantic-search | 6 | 3,772 | Lexical plus LanceDB/transformers semantic search |
| organization | 2 | 1,993 | Organization contracts |
| public-federation, global-sync | 5 | 3,473 | Federation/sync servers |
| community, social, ideation, workshop, notifications, agent-* | 25 | ~7,850 | Community/collaboration features |
| economy-* | 8 | 1,294 | Economy ledger |
| `evolution/`, `curation/`, `memory/`, `wikilink/`, `retrieval/`, `graph/` | 49 | ~3,900 | The only subdirectories |
| ~250 other small files | — | ~25k | Mostly <300 lines each |

Foundations by fan-in (number of production files importing them):
`guidance-runtime` 278, `scope-auth` 113, `filesystem` 90, `moderation-policy` 74, `scope-access` 67, `types` 55.

Cross-cutting: **guidance IDs.** 5,376 `guid-xxxxxxxxxxxxxxxx` literals appear on 5,247 production lines, and 285 files import
`guidance-runtime`. `scripts/guidance-build.ts` scans src, rewrites user-facing strings into `guidanceText('guid-…', …)`,
and emits the generated catalog. Any refactor that moves strings across files must rerun `npm run guidance:check`.

## 2. Candidates with estimates

The estimate method is stated per row. "Lines" are physical lines removed from production `src` unless noted.

| # | Unit | Est. reduction | Method | Risk |
|---|---|---:|---|---|
| R1 | Emit `guidance-defaults.generated.ts` as one JSON entry per line instead of `JSON.stringify(…, null, 2)` | **−78,400** (generated, not production) | 5,356 entries → ~5,360 lines vs 83,781 today. Bytes change little (2.27 MB). | Low–Med: one-line generator change plus regenerate plus `guidance:check`; dist diff is large |
| R2 | `createServer.ts` dispatch: replace the 207-case switch with a table `{tool → service call, arg schema}`; collapse the manual `...(trimmedArgs.x !== undefined && {x: String(…)})` coercions (115 such lines) | −800 to −1,200 | ~2,300-line switch; a table entry costs ~3–5 lines/case → ~1,000–1,400 lines remain | **High**: auth/audit/read-only/owner-activity paths run per case; full integration tests are required (validation.md) |
| R3 | Consolidate re-implemented helpers into one module: `isRecord` (10 files), `processIsAlive` (7 files, 58 lines), `sha256/hash/digest` (~40 files), `sendJson` (3, 35 lines), `normalizePath` (8, 33), `boundedText` (6, 23), `encodeSnapshotString` (3, 19), `canonical*`, plus per-`*-tools.ts` `accessToken`/`prettyPrint` schema fragments (20–24 files) | −250 to −400 | The name-collision scan found 65 names defined in ≥3 files, with 778 "extra copy" lines as an upper bound. Generic names (`text`, `id`, `record`) are false positives, so the realistic share is about one-third to one-half. Bodies must be diffed before merging (same name ≠ same semantics). | Med: subtle semantic drift between copies |
| R4 | Clone cleanup (8-significant-line window, md5) | −250 to −350 | 402 redundant production lines detected: `llm-wiki.ts` 183, `public-federation` 37, `vault-index` 33, `scope-auth` 30, `rest-api` 22, `search` 21, `moderation` 19 | Low–Med |
| R5 | Test-only production modules: `compilation-publication-adapter` (162), `skill-release-admission` (131), `codex-hook-checkpoint` (103), `skill-review-evidence` (70), `graphify-assertion` (64) | −530 production, −480 tests | No production or script importer (checked static and dynamic string references). They may be features in progress, so **ask before deleting**. | Low technically, but a product decision |
| R6 | Smaller dead/test-only declarations (`snapshot-write.writeGzipSnapshot`, `formatCommunityActivityTemplate`, `listSkillReviewTargets`, `hostFeatureEligibility`, …) and 8 unreferenced declarations | −100 to −150 | The declaration scan found 18 test-only declarations (427 lines, incl. R5's adapter) and 8 unreferenced declarations (15 lines) | Low |
| R7 | Split `LlmWikiService` (15.6k-line class) into per-workflow modules: review (reviewPacket/collectReview* ≈1.2k), graph/canvas health (graphHealth 978, canvas, spatial ≈1.4k), lint (computeLint 710), learning/recall (≈0.9k), organization/MOC (≈0.9k), claims/arguments/decisions (≈0.8k), archive (≈0.5k), catalog/home/triage | **≈0** (+50 to +150 for imports) | Moving code does not delete it. Duplication inside the class is low (183 clone lines, counted in R4). | High: `scripts/check-architecture-contracts.mjs` and docs pin `src/llm-wiki.ts`/`llm-wiki.test.ts`; 51 imports |
| R8 | Split `createServer.ts` and `filesystem.ts` along existing seams | ≈0 | Same reasoning as R7 | High (filesystem enforces path/visibility rules) |
| R9 | Nest the flat `src/` (894 root files) into domain folders | 0 | Pure move. Import paths, `guidance-build.ts` (scans only `src/*.ts` at the root), the vitest include list and dist paths all change. | **High**: the guidance generator silently skips subfolders today |

**Totals.** Production: R2+R3+R4+R5+R6 ≈ **−1.9k to −2.6k** (≈2–3% of 94.7k). Tests: −0.5k (R5), plus an unmeasured share from table-driven tests.
Generated: −78k (R1). The repo-wide total would go from 263k to about **182k**, but nearly all of that drop is formatting.

Not measured: test-suite consolidation. Test clones are low (67 redundant lines at the same window), so a test reduction would come
from rewriting tests as table-driven cases. That needs per-file reading and is out of scope for step 1.

## 3. What would actually shrink the code a lot

Features. The repo carries many domains beyond the upstream "Obsidian vault MCP" core: story (3.1k), roleplay (2.2k),
economy (1.3k), workshop/ideation/social/community (~5k), enterprise/federation/global-sync (~7.8k), benchmark (1k), skill-* (3.3k).
Retiring any domain removes its production code, tests, guidance entries, endpoint cases and dist output together.
Which domains are live on the NAS is a user decision. This map does not recommend removals.

## 4. Suggested order (if approved)

1. R1: largest visible drop, isolated to a generator.
2. R5/R6 after a keep/delete answer, then R3/R4 as small reviewed commits.
3. R2 with full integration regression.
4. R7–R9 only if navigability matters more than line count. Fix `guidance-build.ts` subfolder scanning before R9.
