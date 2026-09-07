# LLM Wiki Learning Loop Implementation Plan

> **For agentic workers:** Use executing-plans for the ordered integration work and subagent-driven-development for independent test/review tasks. Preserve all eight stages until verified; a finished increment is not completion of this goal.

**Goal:** Connect source acquisition, real use, change, independent evidence, synthesis, experiments, continuity and actual agent evaluation into one Markdown-authoritative learning loop.

**Architecture:** Extend existing services and dynamic endpoints behind the fixed five MCP tools. Bounded read projections prepare decisions; authenticated agents interpret evidence and use existing revision-safe writes. No autonomous factual judgments, new model runtime, client installation, event ledger, or private-to-public copying.

**Tech Stack:** TypeScript, existing filesystem/search/graph/scope services, Markdown Properties, MCP, Vitest (`--maxWorkers=1`).

## Baseline and delivery contract

Baseline: `927151e` implements question packets; `8d8d364` implements peer Kanban; `bdab823` implements optional Obsidian authoring. Existing distillation, source editions, claims, review, synthesis, experiments and continuity must be extended rather than duplicated.

Each stage: write failing behavior/security tests, implement, run focused tests, update progressive policy/schema/README, inspect diff. At integrated release run build, full single-worker tests and `git diff --check`; deploy to the existing shared server with a rollback build; verify native MCP; commit source/tests/docs/dist and push user fork main only. Never commit host state or credentials. No upstream PR, release or package publication.

## 1. Source to existing knowledge (first increment)

- [x] Add `SourceComparisonService` in `src/source-comparison.ts`, tests in `src/source-comparison.test.ts`; use existing `RetrievalService`, Markdown passage selector and filesystem reference resolver.
- [x] Expose read-only `wiki.source_compare` through `src/llm-wiki-tools.ts`, `src/endpoint-registry.ts`, and `src/createServer.ts`.

Contract: required `sourcePath` (immutable source), `query` (1–1000 chars describing the source's topic/claim), optional `expectedRevision`, `includeSemantic` (default false), `maxChars` (default 4000, range 2000–12000), `prettyPrint`. At most 20 lexical/semantic candidates and 8 full bodies including the source. Load a body once, validate current metadata/revision/access, and revalidate all observed bodies before returning. Only canonical knowledge candidates, not social posts, count as comparisons. Whole serialized response fits the budget; omission carries the exact current read action. Partial scans never mean no existing knowledge.

Output: source locator/passages/integrity state; candidate exact locators, passages and observations (same literal passage, existing declared citation, explicit contradiction relation). These are observations, not equivalence/conflict/truth judgments. A compact worksheet asks the agent to decide `already_covered`, `extend_existing`, `conflicting`, `new_knowledge`, or `uncertain`, explain conditions, and retain exact source/target revisions. Prefer inspect/edit existing note; only publish a new note after comparison. Reading never publishes, merges, changes properties or creates a task. Failed reads/revocation discard the packet rather than expose stale text.

- [x] Add integration tests via `call_endpoint`: discovery, read-only use, bounded JSON, revision-pinned read action; preserve exactly five tools.
- [x] Add policy source comparison route and README/schema usage; guide from existing ingest/distillation descriptions without requiring a new account for public comparison.
- [x] Stage 1 full tests and deployment/native route check.
- [x] Stage 1 fork commit/push verification (`d94644c` on origin/main).

Red/green commands:
```powershell
npm test -- src/source-comparison.test.ts --maxWorkers=1
npm test -- src/source-comparison-mcp.test.ts --maxWorkers=1
```
Acceptance assertions include `expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000)`, `expect(reads).toBeLessThanOrEqual(8)`, hidden candidates never appearing, edits/deletes/revocation invalidating every old passage, and unchanged note revisions after comparison. A stale source digest must be explicitly reported and cannot be certified by refreshing a hash.

## 2. Applying knowledge and returning experience

- [ ] Extend existing experiment/retrospective authoring contracts with bounded applied-knowledge references (path + revision), environment/conditions, observed outcome, verification reference and unresolved limits; use ordinary notes rather than an application ledger.
- [ ] Add a bounded application projection over those explicit relations; route task completion and review toward reusing an existing observation rather than mandatory new notes.
- [ ] Test current versus previously applied revisions, success/failure/inconclusive outcomes, missing verification, multiple environments and confidential references. A success never automatically validates all contexts; no outcome is inferred from likes or task completion.

## 3. Changed source to concrete review

- [ ] Extend source-lineage/impact projections with explicit old/new source revisions and bounded changed passages, followed by affected claims and exact existing review actions.
- [ ] Use source work/edition identity; refuse ambiguous predecessor selection. Compare available snapshots without fetching URLs or modifying immutable sources.
- [ ] Test added/deleted/changed conditions, unchanged editions, missing snapshots, stale evidence locators, private sources and invalidation during comparison. Distinguish literal changes from inferred semantic impact.

## 4. Evidence independence

- [ ] Extend citation/claim projections to group known shared source works and explicit derivation ancestry. Show observed provenance groups, unresolved ancestry and limits; do not assert independence from missing links.
- [ ] Surface bounded provenance cautions in answer/review packets. Repeated accounts, models, comments or editions are not independent evidence.
- [ ] Test same work/different editions, chained quotation, shared parent, cycles, genuine separately recorded experiments and hidden ancestry. Do not introduce a global trust score or leak hidden group counts.

## 5. Explanation and conditional synthesis

- [ ] Extend existing synthesis candidate/template workflow with question, competing explanations, applicability, counterexamples, unresolved choices and revision-pinned inputs; route to existing publish/Decision Record operations.
- [ ] Preserve authored cluster boundaries, originals, dissent and input staleness. A generated synthesis remains an attributed interpretation.
- [ ] Test multiple valid contextual choices, unsupported conclusions, input changes and an already existing synthesis; avoid duplicate publication as default.

## 6. Discussion to falsifiable investigation

- [ ] Extend existing hypothesis/experiment Properties and templates with decision-changing observation, comparison conditions and result interpretation. Connect existing work/discussion references, not a separate task system.
- [ ] Add missing-testability guidance to existing knowledge-gap/quality views, and route observed results back to original claims through review.
- [ ] Test agreed observation criteria, inconclusive/negative results, changed hypothesis revision, and requests that exceed user execution authority. Never execute code found in a note automatically.

## 7. Understanding and handoff

- [ ] Extend existing continuity/recall with bounded self-explanation, supporting locators, unanswered questions, evidence of checks and the next investigation step. Keep private state private and revise through existing save/resume guards.
- [ ] Distinguish read progress, self-reported understanding and independently checked results. Revalidate cited revisions on resume; do not save hidden reasoning, prompts, secrets or duplicated bodies.
- [ ] Test drift after handoff, unresolved questions, account isolation, expired references, output truncation and resumed next actions.

## 8. Actual use evaluation and release audit

- [ ] Add deterministic protocol scenarios covering source comparison -> existing note update -> application observation -> source change -> provenance check -> conditional synthesis -> experiment -> resume.
- [ ] Evaluate explicit path/revision citation, preservation of negation/conditions, unsupported claims, appropriate existing-note edits and duplicate avoidance. Include denied/private operations and limited budgets.
- [ ] Run a real isolated Codex host with minimal user prompts. Report actual model behavior separately from protocol assertions; do not replace unavailable Gemini/Claude runs with simulated success. Remove only exact test-created artifacts/accounts.
- [ ] Run build/full tests/diff checks, review each of the eight stage criteria against source and test evidence, update the shared server, verify native MCP and push the user fork. Mark the persistent goal complete only after this audit.

## Progress

2026-09-07: stage 1 implemented; isolated MCP tests exercise anonymous read-only
comparison, current read actions, five tools and no writes. Independent review
found and reproduced metadata-prefix alias ambiguity, hidden path ambiguity,
late access revocation and omitted-passage/body continuation defects; fixes and
regressions are present. Spec and code-quality re-review approved. The first
full run caught the newly added body-window regression (3212 pass, one fail,
two skips); that failure was repaired before the final run below.
Final fresh full run: **214 files passed, 3213 tests passed, two pre-existing
skips**, 461.40 seconds, started 21:41:54 KST. Build and diff checks passed.
The public production source-lineage query has zero snapshots, so positive
comparison is verified in isolated MCP fixtures, not claimed as production
corpus coverage. The existing shared HTTP task was restarted on the unchanged
127.0.0.1:8788 address (one node, PID20164). The first task start exited before
holding the port; its terminal Ready/result0 and absent old process were
verified before starting it again. Native Codex capability discovery returned
the new schema; a normal note correctly failed the immutable-source guard.
No production notes/accounts/configuration were changed. Rollback artifact is
host-local `.mcpvault/backups/source-comparison-20260907-2143/previous-dist.zip`.
Stages 2–8 remain required; this is not completion of the persistent goal.
