# Coherent collection projection implementation plan

> Execute inline using executing-plans, TDD and verification-before-completion. Do not create agents. The user authorized autonomous improvements and fork main publication.

**Goal:** Make collection organization signals coherent with current lint, bounded and actionable without a separate endpoint or duplicate metadata scan.

**Architecture:** Extract a small collection accumulator. Feed it only coherent visible notes during computeLint and store it privately beside the lint snapshot. The existing collectionHealth helper renders that projection; organizationHealth passes its own lint basis. Preserve existing semantic grouping and legacy action labels but add an exact revision-stamped repair read. The five-tool surface and existing organization endpoint remain unchanged.

**Tech Stack:** TypeScript, existing scoped filesystem and private snapshot guards, Vitest, committed dist.

## Design decisions

- Alternatives: re-read metadata independently (extra IO and differing snapshot); reuse cached query Properties (the observed defect); accumulate from validated lint notes (chosen, one truth for both views).
- Collection health is an internal helper, not a separately registered MCP endpoint. Retry routes must use existing wiki.organization_health and original arguments.
- Keep complete raw grouping keys instead of merging distinct long keys at a shared 500-character prefix. Entry labels are authored declarations, not resolved MOC addresses or permission grants. An action always reads a visible actual member, never executes the raw grouping key.
- Retain at most 120 groups, no unbounded overflow identity set. Overflow counts describe skipped memberships, not distinct collections; collectionTotal is the retained-group count and collectionCountComplete reports incompleteness. Ranking covers retained groups only.
- The most actionable member supplies an exact public path, revision and notes.read action. Existing nextAction string labels remain for compatibility; structured member action and top-level nextAction are executable.
- Whitespace summaries and empty/blank key_points do not count as usable projections. Treat llm_wiki_type knowledge as knowledge even when note_kind is not populated.
- A future review_at crossing invalidates a cached collection basis even if Markdown revisions did not change. Use the earliest future review boundary, not a new polling loop.
- Whole JSON fits 512..12000; remove optional prose and lower ranked groups before exact member identity/revision. An oversized display key can be omitted with groupKeyOmitted without merging its group. If one exact actionable item cannot fit, return an original-request retry without shortened paths; at maximum child budget return an explicit unavailable reason instead of an endless retry. No automatic mutation.
- Private collector state is not serialized. Hidden/foreign owners are never fed; runtime/source IO errors keep propagating from lint. Independently derived graph/Canvas freshness remains open.

## Tasks

- [x] Add temporary-Vault regressions for stale inventory Properties in collection fields, long distinct grouping keys, empty summaries, review time crossings, minimum/maximum budgets, exact scoped actions and bounded overflow counts. Observe failures first.

```ts
const report = await service.organizationHealth(undefined, 30, 16000);
expect(report.collectionHealth.items[0].key).toBe('domain:Current');
const small = await service.collectionHealth(undefined, 20, 512);
expect(JSON.stringify(small).length).toBeLessThanOrEqual(512);
```

- [x] Create src/collection-health.ts with explicit item/result types, bounded accumulator and whole-response packer. Test error-free, truncated, long-identity and due-time cases.
- [x] Wire computeLint/lintSnapshotMatches/collectionHealth/organizationHealth to the same privately stored accumulator, removing the duplicate iterateNotes collection loop. Preserve revision guards and internal lint totals.
- [x] Add public MCP action execution coverage; update the organization description, progressive maintenance guide, README/schema and roadmap. Correct the previously assumed standalone collection endpoint.
- [x] Run targeted tests, build, full npm test, diff check and inline review.
- Publication gate: commit source, tests, docs and generated dist together; verify authorized remote main hash after push. Delivery is reported by the task only after Git succeeds.

## Verification and review (2026-09-05)

- Initial real-fixture run: seven failures and one pass. Reproduced stale domain/MOC Properties, 500-character key collision, empty projection miscounts, missing executable member actions, 2195 characters at a 512 budget and inaccurate overflow totals.
- Added four focused cases: cached-object mutation (observed red), no duplicate inventory query, oversized group label (red), and pure child packer's maximum-budget terminal omission (red). The date-boundary case preserves previously correct direct behavior across the new cached implementation.
- Fixed two parent-packer assumptions that items always exists on a retry, and preserved primary diagnostic capacity by compacting optional collection context first. Restored legacy attentionScore/intent labels when they fit; existing integration assertions were not weakened.
- Scoped MCP test executes the exact member action and matches its revision, excludes hidden and foreign model groups, and verifies five stable tools. Progressive guide version 17 explains counts and action labels without expanding eager instructions.
- Final npm run build passed. Full npm test: 57 files passed, 877 tests passed, one skipped, 48.95s. git -c core.safecrlf=false diff --check passed. Generated declarations preserve optional fields and explicit unavailable/retry shapes.
- Inline review: returned nested target/question objects cannot mutate private cached groups; retained group count is bounded and overflow no longer keeps an unbounded identity set. Source metadata verification cost remains; no constant-time or total-memory-budget claim. Review dates are checked before and after snapshot verification.
- One earlier combined run omitted a waiting item after an external fixture write. Focused reruns and the final full suite passed, but the workDependencySnapshot inventory timing cause is not proven fixed. It is recorded separately from the collection changes; no sleep or test relaxation was introduced.

## Completion scope

This repairs one coherent organization workflow, not the whole active goal. Graph/Canvas direct freshness, inventory scaling and the observed intermittent archive-test timing remain tracked.
