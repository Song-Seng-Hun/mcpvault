# Unified Work Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ordinary actionable Wiki notes the same auditable task-to-knowledge completion gate as managed agent tasks, with a bounded repair path for direct Obsidian edits.

**Architecture:** A pure organization helper normalizes the four disposition choices and enforces mutual exclusion. `AgentTaskService` and `LlmWikiService` share that contract, while each service resolves referenced notes through its existing scope-aware filesystem access. Existing Wiki endpoints gain optional fields; organization lint and the existing review packet recover out-of-band edits without a daemon or second database.

**Tech Stack:** TypeScript, Node.js, MCP SDK JSON Schema, Obsidian Markdown/YAML Properties, Vitest, Git

---

## File map

- Modify `src/organization.ts`: own the normalized disposition vocabulary, pure validation, managed Property contract, and lint invariant.
- Modify `src/organization.test.ts`: prove normalization, exclusivity, field shape, and lint behavior without filesystem concerns.
- Modify `src/agent-tasks.ts`: replace its local duplicate decision logic with the shared helper while retaining role/scope validation.
- Modify `src/agent-collaboration.test.ts`: retain all managed-task completion behavior after the refactor.
- Modify `src/llm-wiki.ts`: validate Wiki completion transitions, visible artifact roles, persistence, read-back fields, and prioritized repair routing.
- Modify `src/llm-wiki-tools.ts`: expose one reusable disposition schema on the existing clarify, publish, and triage endpoints.
- Modify `src/createServer.ts`: forward clarify fields; publish and triage already use thin spreads.
- Modify `src/llm-wiki-tools.test.ts`: prove all three endpoint schemas expose the same bounded contract.
- Modify `src/llm-wiki.test.ts`: cover workflow success, failure, revision safety, hidden/wrong-role references, legacy repair, and bounded review routing.
- Modify `src/wiki-policy.ts`, `src/wiki-policy.test.ts`, `_wiki/SCHEMA.md`, and `README.md`: make the completion rule progressive and public.
- Regenerate committed `dist/` with `npm run build`.

### Task 1: Define the shared disposition contract

**Files:**
- Modify: `src/organization.ts`
- Test: `src/organization.test.ts`

- [x] **Step 1: Write failing normalization and lint tests**

Add tests that call the new pure helper with linked knowledge, negative
knowledge, retrospective, and no-reuse inputs; assert bounded normalized
Properties and these exact failures:

```ts
expect(() => normalizeKnowledgeDisposition({ noReusableKnowledge: true }))
  .toThrow('knowledgeDispositionReason is required');
expect(() => normalizeKnowledgeDisposition({
  noReusableKnowledge: true,
  knowledgeDispositionReason: 'Nothing reusable.',
  retrospective: 'A reusable lesson exists.',
})).toThrow('noReusableKnowledge cannot be combined');
expect(organizationLintIssues('Projects/Done.md', {
  llm_wiki_type: 'knowledge', note_kind: 'project', task_status: 'completed', completed_at: new Date().toISOString(),
}, '# Done')).toEqual(expect.arrayContaining([
  expect.objectContaining({ code: 'completed_work_without_knowledge_disposition' }),
]));
```

- [x] **Step 2: Run the focused tests and observe RED**

Run: `npm test -- src/organization.test.ts`

Expected: FAIL because `normalizeKnowledgeDisposition` and the completion lint
code do not exist.

- [x] **Step 3: Add the pure normalized contract**

Export `KNOWLEDGE_DISPOSITIONS` and a helper with this result shape:

```ts
export type KnowledgeDispositionResult = {
  retrospective?: string;
  knowledgeNotes?: string[];
  negativeKnowledgeNotes?: string[];
  noReusableKnowledge: boolean;
  knowledgeDispositionReason?: string;
  knowledgeDispositions: string[];
};

export function normalizeKnowledgeDisposition(input: {
  retrospective?: unknown;
  knowledgeNotes?: unknown;
  negativeKnowledgeNotes?: unknown;
  noReusableKnowledge?: unknown;
  knowledgeDispositionReason?: unknown;
}, existing: Record<string, unknown> = {}): KnowledgeDispositionResult
```

Normalize lists to at most 20 non-empty 500-character strings, retrospective
and reason to at most 1000 Unicode characters, derive disposition names, and
enforce reason/exclusivity rules. Add managed Property contracts for
`knowledge_notes`, `negative_knowledge_notes`, `retrospective`,
`knowledge_dispositions`, and `knowledge_disposition_reason`. Lint actionable
completed notes whose normalized disposition list is empty or invalid.

- [x] **Step 4: Run the focused tests and observe GREEN**

Run: `npm test -- src/organization.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the pure contract**

```bash
git add src/organization.ts src/organization.test.ts
git commit -m "feat: unify knowledge disposition contract"
```

### Task 2: Reuse the contract in managed agent tasks

**Files:**
- Modify: `src/agent-tasks.ts`
- Test: `src/agent-collaboration.test.ts`

- [x] **Step 1: Add a regression test for existing completed data**

Create a completed task with linked durable and negative notes plus a
retrospective, then make an unrelated revision-safe update without resending
the fields. Assert the existing normalized dispositions remain present.

- [x] **Step 2: Run the regression test before refactoring**

Run: `npm test -- src/agent-collaboration.test.ts`

Expected: PASS, establishing behavior to preserve.

- [x] **Step 3: Replace local disposition derivation with the helper**

Keep `validatedKnowledgeNotes` as the scope/role boundary, then call:

```ts
const disposition = normalizeKnowledgeDisposition({
  retrospective: params.retrospective,
  knowledgeNotes,
  negativeKnowledgeNotes,
  noReusableKnowledge: params.noReusableKnowledge,
  knowledgeDispositionReason: params.knowledgeDispositionReason,
}, note.frontmatter);
if (entersCompleted && disposition.knowledgeDispositions.length === 0) {
  throw new Error(COMPLETION_DISPOSITION_REQUIRED_MESSAGE);
}
```

Persist the helper result using the existing snake-case Properties and delete
a stale `knowledge_disposition_reason` when no-reuse is cleared.

- [x] **Step 4: Run managed-task tests**

Run: `npm test -- src/agent-collaboration.test.ts src/agent-pulse.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the refactor**

```bash
git add src/agent-tasks.ts src/agent-collaboration.test.ts
git commit -m "refactor: share task knowledge disposition rules"
```

### Task 3: Gate ordinary Wiki completion workflows

**Files:**
- Modify: `src/llm-wiki.ts`
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/createServer.ts`
- Test: `src/llm-wiki.test.ts`
- Test: `src/llm-wiki-tools.test.ts`

- [x] **Step 1: Write endpoint and integration tests first**

Assert `publish_knowledge`, `triage_wiki_note`, and `clarify_wiki_note` expose
these optional fields with `maxItems: 20` or `maxLength: 1000`:

```ts
knowledgeNotes, negativeKnowledgeNotes, retrospective,
noReusableKnowledge, knowledgeDispositionReason
```

In integration tests, prove:

1. entering `completed` without a disposition fails;
2. a retrospective succeeds and persists `knowledge_dispositions`;
3. explained no-reuse succeeds and is exclusive;
4. hidden, missing, durable/negative-role-swapped artifacts fail without
   revealing hidden candidates;
5. a stale `expectedRevision` still fails before overwrite;
6. an unrelated edit to a legacy completed note is allowed;
7. explicitly changing disposition fields on a completed note revalidates the
   complete contract.

- [x] **Step 2: Run the focused tests and observe RED**

Run: `npm test -- src/llm-wiki-tools.test.ts src/llm-wiki.test.ts -t "knowledge disposition|schema"`

Expected: FAIL because schemas, forwarding, and Wiki validation are absent.

- [x] **Step 3: Add a shared endpoint schema fragment**

In `src/llm-wiki-tools.ts`, define and spread:

```ts
const knowledgeDispositionProperties = {
  knowledgeNotes: organizationPropertySchema('knowledge_notes', { maxItems: 20, items: { maxLength: 500 } }),
  negativeKnowledgeNotes: organizationPropertySchema('negative_knowledge_notes', { maxItems: 20, items: { maxLength: 500 } }),
  retrospective: organizationPropertySchema('retrospective', { maxLength: 1000 }),
  noReusableKnowledge: { type: 'boolean', description: 'Exclusive explicit completion outcome; requires knowledgeDispositionReason' },
  knowledgeDispositionReason: organizationPropertySchema('knowledge_disposition_reason', { maxLength: 1000 }),
} as const;
```

Spread it into the three existing mutation schemas and clarify in each tool
description that it is required only when entering completed work.

- [x] **Step 4: Add scope-aware Wiki validation and persistence**

Add a private `validatedKnowledgeDisposition` service helper that resolves the
two path lists using `ReferenceService.validateAndNormalize`, reads each note,
and accepts only visible non-hidden `llm_wiki_type: knowledge` notes with the
expected `knowledge_polarity`. Call the pure helper after role validation.

For publish and triage, compute previous/resulting task state and enforce only
when entering completed or when one of the five disposition inputs is present.
Pass the same fields through clarify to triage. Merge normalized Properties
before the optimistic write and return the persisted disposition projection.

- [x] **Step 5: Run focused Wiki tests and observe GREEN**

Run: `npm test -- src/llm-wiki-tools.test.ts src/llm-wiki.test.ts -t "knowledge disposition|schema"`

Expected: PASS.

- [x] **Step 6: Commit the Wiki workflow gate**

```bash
git add src/llm-wiki.ts src/llm-wiki-tools.ts src/createServer.ts src/llm-wiki.test.ts src/llm-wiki-tools.test.ts
git commit -m "feat: gate ordinary work completion on knowledge return"
```

### Task 4: Route direct-edit violations to one bounded repair

**Files:**
- Modify: `src/llm-wiki.ts`
- Modify: `src/wiki-policy.ts`
- Modify: `_wiki/SCHEMA.md`
- Modify: `README.md`
- Test: `src/llm-wiki.test.ts`
- Test: `src/wiki-policy.test.ts`

- [x] **Step 1: Write failing review-routing and policy tests**

Write one actionable completed Markdown note directly without a disposition.
Assert `get_wiki_review_packet` selects it with reason
`completed_work_without_knowledge_disposition`, a bounded read action, and a
revision-safe `wiki.triage` mutation requiring one disposition choice. Assert
the `work` policy names the same rule for both agent tasks and ordinary notes.

- [x] **Step 2: Run the focused tests and observe RED**

Run: `npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts -t "completed work|knowledge disposition"`

Expected: FAIL because generic lint is priority 8 and the work policy only
names agent tasks.

- [x] **Step 3: Add dedicated bounded repair routing**

Split matching lint entries from the generic lint map and add them at priority
2 with reason `completed_work_without_knowledge_disposition` and suggested
tool `wiki.triage`. Build the curation plan as:

```ts
inspect = { endpointId: endpointIdForTool('read_wiki_projection'), arguments: { path, view: 'summary', maxChars: 4000 } };
mutation = {
  endpointId: endpointIdForTool('triage_wiki_note'),
  arguments: { path, expectedRevision: selectedNote.revision },
  requiredArguments: ['knowledgeNotes, negativeKnowledgeNotes, retrospective, or noReusableKnowledge with knowledgeDispositionReason'],
};
```

Keep normal response compaction and attention routing unchanged.

- [x] **Step 4: Update progressive guidance**

Document that this is a provenance/accountability gate rather than factual
proof; retrospectives remain experiential, linked claims still need evidence,
and direct Obsidian edits are repaired rather than rejected. Update README,
the public schema, and `wiki.policy` topic `work` without expanding orientation.

- [x] **Step 5: Run focused tests and commit**

Run: `npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts -t "completed work|knowledge disposition"`

Expected: PASS.

```bash
git add src/llm-wiki.ts src/llm-wiki.test.ts src/wiki-policy.ts src/wiki-policy.test.ts _wiki/SCHEMA.md README.md
git commit -m "feat: surface incomplete work feedback loops"
```

### Task 5: Verify generated output and the repository

**Files:**
- Modify: `dist/**`
- Verify: all source, tests, docs, and generated output

- [x] **Step 1: Build committed distribution output**

Run: `npm run build`

Expected: TypeScript compilation succeeds and `dist/` reflects source changes.

- [x] **Step 2: Run focused behavior suites**

Run: `npm test -- src/organization.test.ts src/agent-collaboration.test.ts src/agent-pulse.test.ts src/llm-wiki-tools.test.ts src/llm-wiki.test.ts src/wiki-policy.test.ts`

Expected: PASS.

- [x] **Step 3: Run the full suite**

Run: `npm test`

Expected: all non-intentionally-skipped tests pass.

- [x] **Step 4: Check patch hygiene and generated files**

Run: `git diff --check`

Expected: exit code 0. Verify `git status --short` contains no credentials,
caches, `.agents/`, or `.mcpvault/` in the staged set.

- [ ] **Step 5: Commit generated output and verification notes**

```bash
git add dist README.md _wiki/SCHEMA.md src docs/superpowers
git commit -m "build: refresh unified completion gate distribution"
```

- [ ] **Step 6: Push only the user fork and verify parity**

Run: `git push origin main`

Expected: `Song-Seng-Hun/mcpvault` `main` advances. Verify `git rev-parse HEAD`
equals `git rev-parse origin/main`; do not create a PR, tag, release, or
upstream push.
