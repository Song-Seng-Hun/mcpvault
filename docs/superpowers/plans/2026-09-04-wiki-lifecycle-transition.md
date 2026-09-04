# Wiki Lifecycle Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, revision-safe planner that retires or reactivates Obsidian knowledge notes without leaving lifecycle, retention, replacement, and `supersedes` metadata inconsistent.

**Architecture:** Keep Markdown and Git authoritative. Add one read-only dynamic Wiki endpoint that validates exact visible notes and emits an atomic `notes.change_set`; the existing generic executor remains the only writer. Tighten general triage, review, and publish paths so retirement or reactivation cannot bypass the planner; specialized Decision Record transitions retain their dedicated workflow.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Vitest, Obsidian Markdown/YAML Properties, the existing `LlmWikiService` and `FileSystem.patchMultipleNotes` transaction.

---

### Task 1: Make retirement metadata representable and prevent incoherent direct transitions

**Files:**
- Modify: `src/organization.ts`
- Modify: `src/organization.test.ts`
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/llm-wiki.ts`
- Test: `src/organization.test.ts`
- Test: `src/llm-wiki.test.ts`

- [x] **Step 1: Write failing Property-contract tests**

Add assertions that `archive_reason` is a managed scalar Property, that `knowledgeOrganization` accepts `archiveReason`, and that an archived note with both archive and retention reasons is lint-clean:

```ts
expect(getOrganizationPropertyContract()).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: 'archive_reason', type: 'text' }),
]));
expect(knowledgeOrganization({
  status: 'verified', noteKind: 'atomic', lifecycle: 'archived',
  archiveReason: 'No longer operational.', retentionPolicy: 'archive',
  retentionReason: 'No longer operational.',
})).toMatchObject({
  lifecycle: 'archived', archive_reason: 'No longer operational.',
  retention_policy: 'archive', retention_reason: 'No longer operational.',
});
expect(organizationLintIssues('Knowledge/Archived.md', {
  llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'archived',
  archive_reason: 'No longer operational.', retention_policy: 'archive',
  retention_reason: 'No longer operational.',
}, '# Archived\n').map(issue => issue.code)).not.toContain('archived_reason_missing');
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/organization.test.ts -t "retirement metadata"`

Expected: failure because `archive_reason`/`archiveReason` is not in the current contract.

- [x] **Step 3: Implement the Property contract**

Add this contract row beside the existing retention fields:

```ts
{ name: 'archive_reason', type: 'text', description: 'Why an archived note left the active knowledge lifecycle' },
```

Add `archiveReason?: unknown` to `KnowledgeOrganizationInput`; normalize it with `optionalText(existing.archive_reason, 'archiveReason', 1000)` and emit `archive_reason` in the returned patch. Keep direct publish, triage, and review schemas limited to active lifecycle states; retirement properties remain planner-owned rather than becoming alternate public write paths.

- [x] **Step 4: Write failing bypass tests**

In `src/llm-wiki.test.ts`, create an active knowledge note and assert:

```ts
await expect(callJson(client, 'triage_wiki_note', {
  path: published.value.path, lifecycle: 'archived', archiveReason: 'Retire it.',
  retentionPolicy: 'archive', retentionReason: 'Retire it.',
  expectedRevision: published.value.revision, accessToken,
})).rejects.toThrow(/wiki\.lifecycle_transition/);

await expect(callJson(client, 'review_wiki_note', {
  path: published.value.path, reviewOutcome: 'superseded', reviewedBy: 'codex',
  nextLifecycle: 'superseded', expectedRevision: published.value.revision, accessToken,
})).rejects.toThrow(/wiki\.lifecycle_transition/);
```

- [x] **Step 5: Add transition guards**

Before either direct writer mutates, compare the existing lifecycle with the requested lifecycle. If an active/inbox/review/evergreen note is newly entering `archived` or `superseded`, throw:

```ts
throw new Error('Use wiki.lifecycle_transition to preview lifecycle, retention, reference impact, and replacement lineage before retiring knowledge.');
```

Block direct retirement metadata edits and transitions both into and out of retired states. Repair retired metadata through the same lifecycle planner so legal holds, replacement scope, reciprocal lineage, and revisions are always rechecked. Do not block ordinary transitions among `inbox`, `active`, `review`, and `evergreen`.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -- src/organization.test.ts src/llm-wiki.test.ts -t "retirement|lifecycle transition"`

Expected: all selected tests pass.

### Task 2: Add a coherent lifecycle-transition planner

**Files:**
- Modify: `src/llm-wiki.ts`
- Test: `src/llm-wiki.test.ts`

- [x] **Step 1: Write failing planner integration tests**

Cover these cases through the MCP test client:

```ts
const archive = await callJson(client, 'get_wiki_lifecycle_transition_preview', {
  path: old.value.path, operation: 'archive', reason: 'Project ended.', accessToken,
});
expect(archive.value).toMatchObject({
  valid: true, operation: 'archive', changes: [expect.objectContaining({
    path: old.value.path,
    frontmatter: { set: expect.objectContaining({
      lifecycle: 'archived', retention_policy: 'archive',
      retention_event: 'manual', archive_reason: 'Project ended.',
      retention_reason: 'Project ended.',
    }) },
  })],
  nextAction: { endpointId: 'notes.change_set' },
});

const supersede = await callJson(client, 'get_wiki_lifecycle_transition_preview', {
  path: old.value.path, operation: 'supersede', replacementPath: successor.value.path,
  reason: 'A corrected note replaces it.', accessToken,
});
expect(supersede.value.changes).toHaveLength(2);
expect(supersede.value.changes[0].frontmatter.set).toMatchObject({
  lifecycle: 'superseded', knowledge_status: 'superseded',
  retention_policy: 'preserve', retention_event: 'superseded',
  replaced_by: '[[Knowledge/New]]',
});
expect(supersede.value.changes[1].frontmatter.set.supersedes).toContain('[[Knowledge/Old]]');
```

Also assert: the planner does not mutate; repeated preview is deterministic except `generatedAt`; an existing canonical `supersedes` edge is not duplicated; malformed/ambiguous successor relations block; self-replacement blocks; source/control/community paths block; legal hold and a future `preserve_until` block retirement; inaccessible/hidden replacements produce no leaked candidate path; `maxChars` below a complete-plan size fails rather than truncating executable changes.

- [x] **Step 2: Run the planner tests and verify RED**

Run: `npm test -- src/llm-wiki.test.ts -t "lifecycle transition planner"`

Expected: failure because the endpoint and service method do not exist.

- [x] **Step 3: Implement `lifecycleTransitionPreview`**

Add a read-only `LlmWikiService.lifecycleTransitionPreview(principal, options)` method with this transport-neutral shape:

```ts
{
  path: string;
  operation: 'archive' | 'supersede' | 'tombstone' | 'reactivate';
  reason: string;
  replacementPath?: string;
  targetLifecycle?: 'active' | 'review' | 'evergreen';
  nextKnowledgeStatus?: 'draft' | 'verified' | 'disputed';
  maxChars?: number;
}
```

Normalize exact paths, require a non-empty reason of at most 1000 Unicode characters, read only visible notes, require `llm_wiki_type: knowledge`, reject moderation-hidden/control/source/community records, and call `assertMutationAllowed` for every proposed edit.

Use these transition patches:

```ts
archive => set {
  lifecycle: 'archived', retention_policy: 'archive', retention_event: 'manual',
  archive_reason: reason, retention_reason: reason,
}; remove ['replaced_by']

supersede => set {
  lifecycle: 'superseded', knowledge_status: 'superseded',
  retention_policy: 'preserve', retention_event: 'superseded',
  retention_reason: reason, replaced_by: canonicalReplacementLink,
}; remove ['archive_reason']

tombstone => set {
  lifecycle: replacementPath ? 'superseded' : 'archived',
  ...(replacementPath ? { knowledge_status: 'superseded' } : {}),
  retention_policy: 'tombstone',
  retention_event: replacementPath ? 'superseded' : 'manual',
  retention_reason: reason,
  ...(replacementPath ? { replaced_by: canonicalReplacementLink } : { archive_reason: reason }),
}; remove replacementPath ? ['archive_reason'] : ['replaced_by']

reactivate => set {
  lifecycle: targetLifecycle || 'review',
  ...(current knowledge_status === 'superseded' ? { knowledge_status: nextKnowledgeStatus } : {}),
}; remove [
  'archive_reason', 'retention_policy', 'retention_event', 'retention_at',
  'retention_reason', 'replaced_by',
]
```

`reactivate` must require `nextKnowledgeStatus` when the current status is `superseded`; it preserves `legal_hold` and `preserve_until`. Retirement must block when `legal_hold` is true or `preserve_until` is a valid future instant.

For a replacement transition, validate both directions with `canReferenceFrom`; canonicalize links with the existing Obsidian relation helper; inspect the successor's complete `supersedes` array; resolve each existing entry with the caller's access predicate; reject malformed, missing, ambiguous, self, or over-limit relation state; append the old note only if absent.

For reactivation of a superseded note, resolve its exact current `replaced_by`, require it to match `replacementPath`, and remove the old note from that successor's complete `supersedes` set. This prevents two active notes from retaining a false replacement edge.

Read bounded incoming reference impact with the same visible access predicate and include only counts plus up to four public paths/contexts. A hidden-scope impact becomes a generic path-free warning, not a veto, because the transition preserves the note body and path. Return no `changes` whenever a blocker exists. Otherwise return one or two exact revision-stamped changes and:

```ts
nextAction: {
  endpointId: endpointIdForTool('patch_multiple_notes'),
  instruction: 'Dry-run this exact lifecycle change set, inspect the revisions and reference impact, then confirm its plan fingerprint.',
}
```

Never alter a body, move a file, delete a note, commit Git, or apply the returned change set.

When a specialized writer such as `publish_decision_record` consumes an already-applied replacement lineage, carry the planner's successor revision into a guarded target write. The filesystem must lock the target and successor together and reject a stale successor before changing the target, closing the validation-to-write race.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/llm-wiki.test.ts -t "lifecycle transition planner"`

Expected: all planner tests pass.

### Task 3: Expose the planner only through the dynamic endpoint surface

**Files:**
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/endpoint-registry.ts`
- Modify: `src/createServer.ts`
- Modify: `src/llm-wiki-tools.test.ts`
- Test: `src/llm-wiki-tools.test.ts`

- [x] **Step 1: Write failing endpoint-surface tests**

Assert that the internal tool maps to `wiki.lifecycle_transition`, appears in capability search with lifecycle/retention/archive/supersede/reactivate terms, remains read-only, and does not increase the fixed five-tool MCP surface.

```ts
expect(endpointIdForTool('get_wiki_lifecycle_transition_preview')).toBe('wiki.lifecycle_transition');
expect(LLM_WIKI_MUTATING_TOOLS).not.toContain('get_wiki_lifecycle_transition_preview');
expect(getLlmWikiTools().find(tool => tool.name === 'get_wiki_lifecycle_transition_preview')).toBeDefined();
```

- [x] **Step 2: Run the surface tests and verify RED**

Run: `npm test -- src/llm-wiki-tools.test.ts -t "lifecycle transition"`

Expected: failure because no mapping or schema exists.

- [x] **Step 3: Add registry, schema, and adapter**

Map `get_wiki_lifecycle_transition_preview` to `wiki.lifecycle_transition`, register `POST /api/wiki/lifecycle-transition`, and add keywords `lifecycle`, `retention`, `archive`, `supersede`, `tombstone`, `reactivate`, `replacement`, and `change set`.

Add this read-only tool contract:

```ts
{
  name: 'get_wiki_lifecycle_transition_preview',
  description: 'Preview one coherent retirement or reactivation of a visible knowledge note. It checks legal preservation, scope-safe reference impact, replacement lineage, and exact revisions, then returns an atomic notes.change_set without writing.',
  inputSchema: { type: 'object', properties: {
    path: { type: 'string' },
    operation: { type: 'string', enum: ['archive', 'supersede', 'tombstone', 'reactivate'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
    replacementPath: { type: 'string' },
    targetLifecycle: { type: 'string', enum: ['active', 'review', 'evergreen'], default: 'review' },
    nextKnowledgeStatus: { type: 'string', enum: ['draft', 'verified', 'disputed'] },
    maxChars: { type: 'integer', minimum: 4096, maximum: 20000, default: 10000 },
    accessToken, prettyPrint,
  }, required: ['path', 'operation', 'reason'] },
}
```

Add a thin `createServer.ts` case that forwards only these validated values to `lifecycleTransitionPreview`; do not add the planner to `MUTATING_TOOLS`, the read-only rejection set, or a write capability.

- [x] **Step 4: Run focused endpoint tests and verify GREEN**

Run: `npm test -- src/llm-wiki-tools.test.ts src/llm-wiki.test.ts -t "lifecycle transition"`

Expected: all selected tests pass.

### Task 4: Document, build, verify, and commit the complete slice

**Files:**
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`
- Modify: `AGENTS.md`
- Modify: `src/wiki-policy.ts`
- Modify: `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md`
- Modify: `dist/**`

- [x] **Step 1: Update progressive guidance**

Document one consistent rule in all relevant layers: use `wiki.lifecycle_transition` before entering or leaving a retired lifecycle; inspect its bounded reference impact; dry-run and confirm the returned `notes.change_set`; Git remains the audit trail; archive/supersede/tombstone never means automatic body deletion.

Add `archive_reason` to the schema's retirement Properties. Keep `AGENTS.md` below its current injection budget by replacing older lifecycle prose rather than appending a second explanation.

- [x] **Step 2: Run documentation and focused tests**

Run: `npm test -- src/wiki-policy.test.ts src/llm-wiki-tools.test.ts src/organization.test.ts src/llm-wiki.test.ts -t "lifecycle|retention|retirement|policy"`

Expected: all selected tests pass and injected guidance remains within its tested bound.

- [x] **Step 3: Build committed distribution output**

Run: `npm run build`

Expected: TypeScript succeeds and `dist/` reflects the source changes.

- [x] **Step 4: Run the complete verification gate**

Run: `npm test`

Expected: the full Vitest suite passes.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only this feature's source/tests/docs/plan/generated `dist/` plus the pre-existing untracked `.agents/` and `.mcpvault/` are present.

- [x] **Step 5: Commit only the feature files**

```bash
git add AGENTS.md README.md _wiki/SCHEMA.md docs/superpowers/plans/2026-09-04-wiki-lifecycle-transition.md plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md src/organization.ts src/organization.test.ts src/llm-wiki.ts src/llm-wiki.test.ts src/llm-wiki-tools.ts src/llm-wiki-tools.test.ts src/endpoint-registry.ts src/createServer.ts src/wiki-policy.ts dist
git commit -m "feat: add coherent wiki lifecycle transitions"
```

Do not stage `.agents/` or `.mcpvault/`. Do not push, publish, release, open a PR, or contribute upstream.
