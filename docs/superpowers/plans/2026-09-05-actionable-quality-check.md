# Actionable quality check implementation plan

> **For agentic workers:** Use executing-plans inline. Do not create additional agents; preserve the user's fork-only publication rule.

**Goal:** Make the existing single-note organization quality rubric current, privacy-safe, bounded, and useful for the next authoring step without converting it into a publication gate.

**Architecture:** Keep `wiki.quality_check`, its existing path/maxChars schema, and all five fixed MCP tools. Evaluate one captured Markdown revision, then freshly validate the source before returning. Preserve existing check IDs and legacy `nextActions` IDs; add one exact non-mutating `nextAction`. Prefer failed checks when compacting. No second task queue, implicit repair, global scan, source fetch, or note mutation.

**Tech Stack:** Existing TypeScript services, Vitest filesystem fixtures, in-memory MCP integration, committed generated dist.

## Contract and chosen trade-offs

- Fix the existing quality rubric rather than introduce a second report or automatic repair worker. It checks authored structure, not the factual truth or integrity of cited sources.
- Hidden, removed, and quarantined sources are unavailable even to an otherwise scope-authorized caller. A source changed, hidden, or deleted after the captured read yields a retryable error, not mixed-revision diagnostics. Genuine read failures propagate.
- Resolve authorized scope URIs and require relative physical paths before reading; absolute/traversal aliases cannot bypass scope interpretation or produce inconsistent continuation targets.
- `compact_projection` requires nonempty string summary/key-points. If a projection exists, `projection_freshness` distinguishes missing/unverified, stale, and current `summary_of_content_sha256`. A stale fingerprint is never repaired automatically or presented as permission to certify old prose.
- Literature interpretation passes only for explicitly `interpreted` or `synthesized` notes. Merely having a link, omitting the field, or authoring an unknown status is not interpretation.
- Empty/malformed evidence arrays do not pass the declaration check. Both `evidence_paths` and structured `evidence[].path` are recognized as declarations. Actual source verification remains the evidence/review workflow, explicitly outside this rubric's score.
- Reuse the graph's native-link and navigational Property contract so authored Properties/typed relations count without resolving other notes. Ignore blank reference placeholders and fenced examples; trim/case-normalize kind and uncertainty before selecting checks.
- Preserve every diagnostic and authored rubric order when they fit. Under smaller budgets put failed checks first, retain whole-score counts, exact source revision, advisory flag, and an executable `notes.read` for the same target. `nextActions` remains the IDs of displayed failures.
- Bound the entire serialized response, including title, role names, checks, and actions. If even the exact path/read cannot fit, emit a compact `retry` that reuses original arguments with `maxChars: 12000`; never truncate a path or echo credentials.

## Implementation steps

### 1. Failing regression fixtures

Files: create `src/quality-check.test.ts`; extend `src/createServer.test.ts`.

- [x] Use real temporary Vaults with `FileSystemService`, `ScopeAccessPolicy`, and `LlmWikiService`. Seed hidden and private notes; stale/unverified/current summaries; invalid interpretation/evidence values; long titles, paths, and late role-specific failures.
- [x] Preserve the captured source, change it in a `readNote` wrapper, and require the report to reject it rather than return stale diagnostics. Inject a genuine read failure separately.
- [x] Verify whole JSON at 512/600/1000/6000/12000 characters, exact next-action target/revision, failure-first compaction, and no file mutation.

```ts
const report = await service.qualityCheck(undefined, 'Concept.md', 512);
expect(JSON.stringify(report).length).toBeLessThanOrEqual(512);
expect(report.nextAction).toEqual({ endpointId: 'notes.read', arguments: { path: 'Concept.md', maxChars: 3000 } });
expect(report.checks[0].passed).toBe(false);
```

- [x] Run `npm test -- src/quality-check.test.ts` and inspect expected red failures before changing production code.

### 2. Implement current, bounded authoring diagnostics

File: `src/llm-wiki.ts`, method `qualityCheck` and a local helper only if it makes the packing contract clearer.

- [x] Check scope before read; reject moderation-hidden notes; retain the original raw-file revision. At the end call fresh/strict `readNoteMetadata` on that one path and reject missing, hidden, or changed results.
- [x] Tighten the projection, interpretation, and declaration predicates without reading other notes. Keep knowledge-role and execution-state checks separate.
- [x] Add a same-target read action only when failures exist. Preserve rubric order for full output, select failed diagnostics first for compact output, then shorten descriptions without altering IDs or paths. If the minimal exact result exceeds the budget, return the same-request retry contract.

```ts
const retry = { endpointId: 'wiki.quality_check', reuseOriginalArguments: true, overrides: { maxChars: 12000 } };
// A retry carries no truncated path or stale title; the caller retains its original arguments.
```

- [x] Run `npm test -- src/quality-check.test.ts src/createServer.test.ts src/llm-wiki.test.ts`; inspect regressions without weakening assertions.

### 3. Public contract, roadmap reconciliation, and delivery

Files: `src/llm-wiki-tools.ts`, `README.md`, `_wiki/SCHEMA.md`, `docs/ORGANIZATION-ROADMAP.md`, generated `dist/`.

- [x] Update the existing endpoint description and progressive documentation with authoring-only scope, current revisions, failed-check prioritization, read-before-edit guidance, and exact retry rules.
- [x] Through `call_endpoint`, exercise `wiki.quality_check` with prettyPrint at minimum budget; execute its returned read action in the same authenticated scope. Confirm no new fixed MCP tools and rejection of hidden notes.
- [x] Replace the roadmap's blanket statement that no previously identified gap remains with an evidence-scoped audit status; record this workflow's verification separately from whole-goal completion.
- [x] Run `npm run build`, full `npm test`, and `git diff --check`. Review source and generated diff.
- Publication gate: commit and push only the user's fork main, then compare local/remote hashes before claiming delivery. Publication is verified after committing this plan, not presumed by these checkboxes.

## Not claimed

No automatic source-fact verification, global quality score, enforced section ritual, automatic fingerprint correction, runtime server restart, or completion of the overall organization goal. This is one existing authoring workflow repaired end-to-end.

## Verified implementation evidence (2026-09-05)

- Recovered the unfinished worktree; the old test handle `19294` was absent, so it was not treated as a passing run.
- Five new regressions failed as expected: kind/uncertainty whitespace, three Property-navigation forms, and malformed references with fenced examples. They pass after the shared graph-reference contract and normalization repair.
- Targeted `quality-check`, policy, MCP, and LlmWiki service suites: 171 passed.
- Fresh final full suite: 54 files, 828 passed, one existing platform skip (829 total); exit 0. Build and `git -c core.safecrlf=false diff --check`: exit 0.
- Reviewed scope resolution, moderation/current-revision rejection, failure-first whole-result budgets, direct-service/public MCP continuation, generated declarations, and progressive policy. No new agent, endpoint, external helper, source verification claim, or live Vault mutation was introduced.
- A final revision check detects intervening edits; it is not a transaction locking a note against edits after the response. Callers must re-read and use expectedRevision for a later mutation.
- The separate exception-board aggregation/budget audit and representative archive scaling measurements remain open in the roadmap. Overall goal remains active.
