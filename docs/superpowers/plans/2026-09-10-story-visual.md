# Source-linked Story Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add source-linked story projections and safe, bounded alternative prose proposals to the existing MCP workflow.

**Architecture:** A pure annotation/patch module validates content-local structure. Shared StoryWorkspace services resolve sources and persist through existing guarded artifact writes; `story.visual` remains a dynamic endpoint under the fixed control plane.

**Tech Stack:** TypeScript, Node, Markdown/Properties, Vitest; no new dependency or external model call.

---

Approved specification: [design](../specs/2026-09-10-story-visual-design.md).
User workflow overrides skill commit/worktree defaults: preserve the current
shared checkout and do not branch, stage, commit, push, or publish.

## Task 1: Pure visual contract and passage editing

Files: create `src/story-visual-model.ts` and `src/story-visual-model.test.ts`.
Worker owns only those two files; main owns integration and docs. Only main
runs build/full-suite commands. Worker may run its isolated test file.

- [x] Write failing tests for this public contract:

```ts
export interface StoryVisualEvent {
  id: string; actorId: string; targetId?: string; locationId?: string;
  action: string; basis: 'stated' | 'inferred' | 'uncertain';
  passage: { start: number; end: number; quote: string };
}
export interface StoryVisualModel { events: StoryVisualEvent[] }
export type StoryVisualIntent =
  | { type: 'move_entity'; eventIds: string[]; actorId: string; locationId: string }
  | { type: 'set_action'; eventIds: string[]; action: string }
  | { type: 'reorder_events'; eventIds: string[] };
export interface StoryVisualChange {
  eventId: string; start: number; end: number; before: string; after: string;
}
export function parseStoryVisual(value: unknown): StoryVisualModel;
export function assertStoryVisualPassages(model: StoryVisualModel, content: string): void;
export function parseStoryVisualIntent(value: unknown, model: StoryVisualModel): StoryVisualIntent;
export function applyStoryVisualEdits(model: StoryVisualModel, content: string,
  intent: StoryVisualIntent, replacements?: unknown): { content: string; changes: StoryVisualChange[] };
```

- [x] Run `npm test -- src/story-visual-model.test.ts`; observe missing-export assertion failure before implementing.
- [x] Implement the above interface with the approved limits, strict field allowlists, Unicode locators, matching fences, overlap checks, and deterministic span replacement. Import existing story validators, not new path/auth logic.
- [x] Rerun the isolated suite until green; report exact command/count. Main reviews spec, then requests quality review.

## Task 2: Shared service and artifact integration

Files: create `src/story-visual.ts`, `src/story-visual.test.ts`; modify
`src/story-model.ts`, `src/story-artifacts.ts`, `src/story-service.ts`,
`src/story-editorial.ts` (revalidation before review/adoption).

- [x] Write failing real-service fixture tests following `src/story-service.test.ts`; start with creation of a visual_model and exact-source read, then preview/propose.

```ts
const intent = { type: 'move_entity', eventIds: ['arrival'], actorId: 'iris', locationId: 'garden' };
const preview = await service.execute('visual', {
  op: 'preview', projectId: 'novel', modelId: 'opening-map',
  sourceRevision: modelRevision, intent,
}, writer);
const result = await service.execute('visual', {
  op: 'propose', projectId: 'novel', modelId: 'opening-map',
  sourceRevision: modelRevision, intent, fingerprint: preview.fingerprint,
  replacements: [{ eventId: 'arrival', content: 'Iris enters the garden.' }],
  artifactId: 'opening-garden', title: 'Garden alternative',
  expectedRevision: 'missing', expectedProjectRevision: projectRevision,
  requestId: 'garden-variation',
}, writer);
expect(result.kind).toBe('alternative');
```

- [x] Run `npm test -- src/story-visual.test.ts`; confirm the new endpoint/kind is missing.
- [x] Add artifact data fields `visual` and `visualProposal` and kind `visual_model`. Add shared async validation for kinds, source scene, entity/place dependencies, exact pins, proposal fingerprint/patch audit and no forged metadata. Preserve existing behavior when fields are absent.
- [x] Implement read/preview/propose in `StoryVisual`, reusing guarded artifact writes and bounded projection/detail helpers. Bind preview to project, full dependency revisions, selection, intent and actor; compare before writing. Add operation/field dispatch in StoryService.
- [x] Extend service tests for scope, revisions/races, retries, bounds, read-only mode, forged direct artifact calls and unchanged originals/sequences. Run `npm test -- src/story-visual.test.ts src/story-service.test.ts src/story-core-regressions.test.ts`.

## Task 3: Dynamic tool schema, discovery, docs, and final verification

Files: modify `src/story-tools.ts`, `src/endpoint-registry.ts` as needed by its
existing story operation mapping, `src/story-tools.test.ts`, `src/story-mcp.test.ts`,
`docs/creative-workspace.md`, `_wiki/SCHEMA.md`, and client story guidance when
relevant. `README.md` and `src/wiki-policy.ts` route the new capability through
existing progressive documentation; `src/wiki-policy-contract.test.ts` checks
its route and bounded guidance. Build owns generated `dist/` and guidance output.

- [x] Add failing schema/discovery tests for the new dynamic endpoint, bounded visual data and read/write aliases. Assert `read`/`preview` are read-only while `propose` requires existing story write/task access.
- [x] Run `npm test -- src/story-tools.test.ts src/story-mcp.test.ts`; observe the missing endpoint assertions.
- [x] Add exact schemas matching the approved contract and service; reuse STORY_OPERATIONS in registry/adapters. Do not add a sixth stable tool or direct REST-only business logic.
- [x] Document an end-to-end model → read → preview → propose → reread → review example, partial/uncertain annotations, Unicode offsets, stale recovery, and the explicit follow-up needed to replace a sequenced scene.
- [x] Complete spec and quality reviews; fix actionable findings and rerun affected tests.
- [x] Run `npm run build`, `npm test`, `git diff --check`, and inspect changed/generated paths. Expected: successful build, no failing tests, no whitespace errors, no secret/cache commits. Record actual results rather than predicted counts.
- [x] Report source/docs paths, completed capabilities and limitations. No runtime restart or live Vault mutation is part of this increment.

## Execution record — 2026-09-10

- Implemented the approved MCP-only increment without dependencies, automatic
  model calls, a separate UI, or changes to the running host/live Vault.
- Main owned shared services, adapters, and documentation; a bounded worker
  owned only the pure model and its tests. Independent specification and quality
  reviews completed. Final quality review found no remaining Critical or
  Important issues; it was code review, not a substitute for test execution.
- Tests were observed failing before implementation. Regression fixes cover
  strict intent fields, literal YAML-looking body text, missing/duplicate source
  pins, targetless interactions, and revalidation of host-edited visual data
  before review/adoption. The final focused visual service run passed 17 tests;
  the pure contract suite passed 40 tests.
- Fresh `npm run build` and `npm run guidance:check` passed after the final
  source fix; generated `dist/` and guidance output are present. Tracked diff
  whitespace checks and explicit checks of 16 visual-increment paths passed.
- Initial full parallel run: 344 files passed, 1 failed; 4624 tests passed,
  1 failed, 2 skipped. The existing roleplay MCP test hit its 5000 ms timeout;
  its isolated rerun passed. A two-worker full run subsequently reported 343
  files passed, 2 failed; 4626 tests passed, 2 failed, 2 skipped. Failures were
  that same timeout and `ENOTEMPTY` while the existing situation-evaluation
  fixture removed its temporary directory. Neither assertion/time limit nor
  either unrelated test was changed to suppress these failures.
- Final frozen-source full run: `npm test -- --maxWorkers=1` passed with exit 0.
  All 345 test files passed; 4629 tests passed and 2 were skipped (4631 total).
  Started 04:01:33 KST; duration 1118.61 seconds. Both earlier failing tests
  passed in this serial run. Parallel-run instability remains recorded above;
  this result does not establish that parallel timing/cleanup is now reliable.
- These checks establish software behavior, not improved literary quality.
  Runtime activation, interactive client rendering, and a controlled creative
  comparison remain separate work. No branch, commit, push, or publication.

## Authorized deployment follow-up — 2026-09-10

The user subsequently explicitly required NAS application, commit and fork push
on the existing branch. This supersedes the earlier no-deployment/no-commit
execution boundary; it does not authorize package/release publication or a new
branch. The standing repository workflow now records that completion rule.

- Fresh build passed. Deployment-focused serial tests passed all 89 tests across
  seven files. The immediately preceding frozen full suite remains 345 files,
  4629 passed and two skipped; no application source changed during deployment.
- Staged and SHA-256 compared all 702 `dist/` files plus `package.json` against
  the built checkout. Preserved the prior release and launcher for rollback.
- Replaced only the verified scheduled MCPVault server. New runtime PID 18116
  uses the `20260910-visual-story` release and the same live NAS Vault and host
  configurations. Both writer recoveries used the official fingerprint-checked
  audit procedures; no journal, checkpoint, world turn, or issued XP was reset.
- Actual MCP verification confirmed the fixed five tools, all nine `story.*`
  endpoints including `story.visual`, current story policy, and handler dispatch.
  Verification used missing-target reads, not fabricated production story data.
- Read-back verification preserved the ready world at the same revision,
  available XP 500 / escrow 0, empty market, and the existing skill evaluation.
  Anonymous wallet access remains denied. No credentials or note bodies were
  printed. Local deployment helpers, logs and secret storage are not Git content.
