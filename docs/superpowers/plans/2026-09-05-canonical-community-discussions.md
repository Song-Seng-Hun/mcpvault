# Canonical Community Discussions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the disconnected legacy discussion API while preserving old Markdown records as immutable, bounded, promotable history behind the canonical Community workflow.

**Architecture:** Remove the four legacy discussion tools from the dynamic endpoint registry and route their discovery language to the existing Community services. Protect `_collaboration/discussions` at the shared path-mutation boundary, and teach the existing bounded promotion report to recover legacy conclusions without rewriting them.

**Tech Stack:** TypeScript, Node.js, MCP TypeScript SDK, Vitest, Obsidian Markdown/YAML, Git

---

### Task 1: Make Community the only discoverable discussion API

**Files:**
- Modify: `src/createServer.test.ts`
- Modify: `src/endpoint-registry.ts`
- Modify: `src/collaboration-tools.ts`
- Modify: `src/createServer.ts`
- Modify: `src/scopes.ts`
- Modify: `src/scopes.test.ts`

- [ ] **Step 1: Write failing endpoint-registry tests**

Extend the endpoint catalog test to require:

```ts
expect(runtime.endpointRegistry.resolve('mcp.create_discussion')).toBeUndefined();
expect(runtime.endpointRegistry.resolve('mcp.get_discussion')).toBeUndefined();
expect(runtime.endpointRegistry.resolve('mcp.add_discussion_argument')).toBeUndefined();
expect(runtime.endpointRegistry.resolve('mcp.update_discussion_status')).toBeUndefined();
expect(runtime.endpointRegistry.resolve('community.status')).toMatchObject({
  method: 'POST',
  url: '/api/community/status',
});
```

Add one control-plane integration test that searches each old operation name and
asserts that the only matching executable replacement is respectively
`community.post`, `community.post_read`, `community.comment`, or
`community.status`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- src/createServer.test.ts -t "canonical Community discussion"
```

Expected: failure because the four legacy descriptors still exist and
`update_community_status` still resolves to `mcp.update_community_status`.

- [ ] **Step 3: Remove the legacy tools and assign canonical aliases**

In `src/collaboration-tools.ts`, remove the four discussion tool descriptors and
remove their mutation names from `COLLABORATION_MUTATING_TOOLS`.

In `src/createServer.ts`, remove the three discussion capability entries and the
four dispatcher cases.

In `src/scopes.ts`, remove `randomUUID`, `DISCUSSION_STATUSES`,
`DISCUSSION_STANCES`, `discussionPath`, `evidenceLines`, and the four discussion
methods. Remove the now-obsolete service test from `src/scopes.test.ts`.

In `src/endpoint-registry.ts`, add:

```ts
update_community_status: 'community.status',
```

and:

```ts
update_community_status: { method: 'POST', url: '/api/community/status' },
```

Add exact legacy operation aliases to the canonical endpoint aliases:

```ts
publish_blog_post: ['create_discussion', 'create discussion', /* existing aliases */],
read_blog_post: ['get_discussion', 'get discussion', /* existing aliases */],
comment_on_blog_post: ['add_discussion_argument', 'add discussion argument', /* existing aliases */],
update_community_status: ['update_discussion_status', 'update discussion status', 'resolve discussion', 'close discussion'],
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- src/createServer.test.ts src/scopes.test.ts src/agora.test.ts
```

Expected: all tests pass, and no legacy endpoint appears in the registry.

- [ ] **Step 5: Commit the endpoint consolidation**

```bash
git add -- src/createServer.test.ts src/endpoint-registry.ts src/collaboration-tools.ts src/createServer.ts src/scopes.ts src/scopes.test.ts
git commit -m "refactor: canonicalize public discussions"
```

### Task 2: Freeze legacy discussion records at the shared path boundary

**Files:**
- Modify: `src/scope-access.ts`
- Modify: `src/createServer.test.ts`

- [ ] **Step 1: Write failing mutation-boundary tests**

Seed `_collaboration/discussions/history.md`, authenticate a publisher, and test
all generic path mutation shapes. At minimum cover direct write/patch/delete,
old/new move paths, frontmatter/tag mutation, and a change-set member:

```ts
const legacyPath = '_collaboration/discussions/history.md';
for (const operation of [
  ['write_note', { path: legacyPath, content: 'changed', expectedRevision: revision }],
  ['patch_note', { path: legacyPath, oldText: 'old', newText: 'changed', expectedRevision: revision }],
  ['delete_note', { path: legacyPath, expectedRevision: revision }],
  ['move_note', { oldPath: legacyPath, newPath: 'History.md' }],
  ['move_note', { oldPath: 'History.md', newPath: legacyPath }],
  ['update_frontmatter', { path: legacyPath, properties: { status: 'open' }, expectedRevision: revision }],
  ['manage_tags', { path: legacyPath, operation: 'add', tags: ['x'], expectedRevision: revision }],
  ['patch_multiple_notes', { changes: [{ path: legacyPath, expectedRevision: revision, content: 'changed' }] }],
] as const) {
  const result = await client.callTool({ name: operation[0], arguments: { ...operation[1], accessToken } });
  expect(result.isError).toBe(true);
  expect((result.content as any)[0].text).toContain('community.post');
}
```

Also verify `read_note` with a small `maxChars` succeeds and reports
`truncated: true` for a long legacy transcript.

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```bash
npm test -- src/createServer.test.ts -t "legacy discussion records"
```

Expected: generic mutations currently succeed or fail for unrelated reasons,
not at the legacy-record boundary.

- [ ] **Step 3: Add one reusable path predicate and mutation rejection**

In `ScopeAccessPolicy`, add:

```ts
isLegacyDiscussionPath(path: string): boolean {
  const normalized = normalizePhysicalPath(path).toLowerCase();
  return normalized === '_collaboration/discussions'
    || normalized.startsWith('_collaboration/discussions/');
}
```

Extend `assertMutationAllowed`:

```ts
if (this.isLegacyDiscussionPath(normalized)) {
  throw new Error(`${operation} cannot mutate legacy discussion history; use community.post, community.comment, and community.status`);
}
```

Because every generic path mutation already passes through
`assertImmutableSourceBoundary`, no second policy implementation is added.

- [ ] **Step 4: Run the boundary and security tests**

Run:

```bash
npm test -- src/createServer.test.ts src/security-hardening.test.ts
```

Expected: all tests pass; legacy reads remain available and mutations are
rejected before filesystem writes.

- [ ] **Step 5: Commit the immutable-history boundary**

```bash
git add -- src/scope-access.ts src/createServer.test.ts
git commit -m "fix: freeze legacy discussion history"
```

### Task 3: Recover legacy conclusions through the bounded promotion queue

**Files:**
- Modify: `src/llm-wiki.test.ts`
- Modify: `src/llm-wiki.ts`

- [ ] **Step 1: Write a failing legacy-promotion test**

Seed a resolved `_collaboration/discussions/rewrite-policy.md` note with
participants, one evidence item, a long body, and a known revision. Call
`get_wiki_promotion_candidates` with `limit: 5` and `maxChars: 3000`, then assert:

```ts
expect(result.value.items).toEqual(expect.arrayContaining([
  expect.objectContaining({
    sourceType: 'legacy_discussion',
    discussionId: 'rewrite-policy',
    status: 'resolved',
    revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    promotionPlan: expect.objectContaining({
      inspect: {
        endpointId: 'notes.read',
        arguments: { path: '_collaboration/discussions/rewrite-policy.md', maxChars: 7000 },
      },
    }),
  }),
]));
expect(JSON.stringify(result.value).length).toBeLessThanOrEqual(3000);
```

- [ ] **Step 2: Run the promotion test and verify RED**

Run:

```bash
npm test -- src/llm-wiki.test.ts -t "legacy discussion promotion"
```

Expected: no `legacy_discussion` candidate is returned.

- [ ] **Step 3: Add metadata-first legacy candidate collection**

In `promotionCandidates`, add a second discussion scan over
`_collaboration/discussions`. Accept only `mcpvault_type: discussion`, validate
the status against `open`, `resolved`, `rejected`, and `superseded`, and rank
resolved records above open records. Return bounded participants and evidence,
use `notes.read` for inspection, and reuse the existing Wiki preflight/publish
steps. Do not parse arguments into synthetic authors or comments.

Extend the hydration branch so both `community_discussion` and
`legacy_discussion` receive a 360-character excerpt from the original body.

- [ ] **Step 4: Run focused promotion and bounded-output tests**

Run:

```bash
npm test -- src/llm-wiki.test.ts -t "promotion"
```

Expected: Community posts, completed tasks, and legacy records all remain
ranked and bounded.

- [ ] **Step 5: Commit historical promotion support**

```bash
git add -- src/llm-wiki.ts src/llm-wiki.test.ts
git commit -m "feat: recover legacy discussion knowledge"
```

### Task 4: Align guidance, generated output, and release evidence

**Files:**
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`
- Modify: `AGENTS.md`
- Modify: `dist/**` generated files

- [ ] **Step 1: Replace the duplicate workflow documentation**

Replace the README section claiming active discussions live in
`_collaboration/discussions` with the canonical endpoint sequence and a migration
note: old files are immutable history, readable by exact path, and discoverable
as promotion candidates. Add the same compact rule to `_wiki/SCHEMA.md` and the
community endpoint selection table in `AGENTS.md`.

- [ ] **Step 2: Build tracked runtime output**

Run:

```bash
npm run build
```

Expected: TypeScript succeeds and tracked `dist/` reflects the endpoint,
access-policy, and promotion changes.

- [ ] **Step 3: Run targeted and full verification**

```bash
npm test -- src/createServer.test.ts src/scopes.test.ts src/agora.test.ts src/llm-wiki.test.ts
npm test
git diff --check
```

Expected: all tests pass, no whitespace errors, and no unbounded legacy API is
discoverable.

- [ ] **Step 4: Commit generated output and documentation**

```bash
git add -- README.md _wiki/SCHEMA.md AGENTS.md dist
git commit -m "docs: route discussions through Community"
```

- [ ] **Step 5: Independently review and publish only to the user fork**

Request a read-only code review of the complete implementation range. Resolve
all Critical and Important findings with a failing regression test first. Then
verify the exact origin URL is `https://github.com/Song-Seng-Hun/mcpvault.git`,
push `main`, and compare `git rev-parse HEAD` with
`git ls-remote origin refs/heads/main`. Do not create a PR, release, tag, or
package publish.
