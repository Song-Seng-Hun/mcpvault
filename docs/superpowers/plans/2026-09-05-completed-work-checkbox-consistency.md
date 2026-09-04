# Completed Work Checkbox Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect completed actionable notes that still contain real open Markdown tasks and route one bounded, revision-safe repair without changing Markdown automatically.

**Architecture:** Move the existing fence-aware task extractor into one dependency-light module consumed by filesystem task operations and organization lint. Add one advisory lint code and promote it through the existing review packet; keep the fixed five-tool MCP surface and all authoritative write paths unchanged.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Obsidian Markdown/YAML, Vitest

---

## File map

- Create `src/markdown-tasks.ts`: stable task identity and the sole Markdown checkbox parser.
- Create `src/markdown-tasks.test.ts`: parser characterization across frontmatter, fences, markers, and stable IDs.
- Modify `src/filesystem.ts`: consume the shared parser without changing list/update behavior.
- Modify `src/createServer.ts`, `src/createServer.test.ts`: make task-list
  projections character-bounded while preserving stable locators.
- Modify `src/organization.ts`: emit the completed/open-checkbox consistency issue.
- Modify `src/organization.test.ts`: prove the invariant and fence behavior.
- Modify `src/llm-wiki.ts`: prioritize and route the issue.
- Modify `src/llm-wiki.test.ts`: prove bounded repair behavior and non-mutation.
- Modify `src/wiki-policy.ts`, `src/wiki-policy.test.ts`, `README.md`, `_wiki/SCHEMA.md`: progressive user guidance.
- Regenerate tracked `dist/` output with the normal build.

### Task 1: Share the existing Markdown task parser

- [x] **Step 1: Add a failing parser characterization test**

Create `src/markdown-tasks.test.ts` with a note containing YAML, `- [ ]`,
`* [x]`, matching backtick/tilde fenced examples, and a `^block-id`. Assert that
only the two real tasks are returned, their lines and statuses are exact, and
the block task ID is `task:block:block-id`.

```ts
import { describe, expect, test } from 'vitest';
import { extractMarkdownTasks } from './markdown-tasks.js';

describe('extractMarkdownTasks', () => {
  test('keeps one fence-aware task dialect and stable identities', () => {
    const tasks = extractMarkdownTasks([
      '---', 'example: "- [ ] not a task"', '---', '# Plan',
      '- [ ] Open work ^block-id', '* [x] Finished work',
      '```md', '- [ ] fenced backtick', '```',
      '~~~md', '- [ ] fenced tilde', '~~~',
    ].join('\n'), 'Projects/Plan.md');
    expect(tasks.map(task => ({ line: task.line, status: task.status, taskId: task.taskId }))).toEqual([
      { line: 5, status: 'open', taskId: 'task:block:block-id' },
      { line: 6, status: 'completed', taskId: expect.stringMatching(/^task:content:/) },
    ]);
  });
});
```

- [x] **Step 2: Run RED**

Run `npm test -- src/markdown-tasks.test.ts`.
Expected: fail because `src/markdown-tasks.ts` does not exist.

- [x] **Step 3: Extract the parser**

Create `src/markdown-tasks.ts` by moving `taskIdentity` and `extractTasks` from
`src/filesystem.ts`. Export the parser as:

```ts
export function extractMarkdownTasks(content: string, path: string): TaskItem[]
```

Keep the current SHA-256 identity input, frontmatter handling, matching fence
rules, list marker rules, line numbering, status values, and occurrence logic
byte-for-byte equivalent. Import `extractMarkdownTasks` in `filesystem.ts` and
replace all three `extractTasks(...)` call sites. Remove only the old private
functions; retain `createHash`, which also computes note revisions.

- [x] **Step 4: Run parser and filesystem tests**

Run `npm test -- src/markdown-tasks.test.ts src/filesystem.test.ts`.
Expected: both files pass and the existing stable-task relocation test remains green.

- [x] **Step 5: Commit**

Commit `src/markdown-tasks.ts`, `src/markdown-tasks.test.ts`, and
`src/filesystem.ts` as `refactor: share fence-aware markdown task parsing`.

### Task 2: Add the completed-work consistency invariant

- [x] **Step 1: Add failing organization tests**

Extend `src/organization.test.ts` with a completed actionable note carrying a
valid retrospective disposition. Assert that a real `- [ ]` produces
`completed_work_with_open_checkboxes`, while completed boxes, YAML examples,
and matching backtick/tilde fenced examples do not.

```ts
const frontmatter = {
  llm_wiki_type: 'knowledge', note_kind: 'task', lifecycle: 'active',
  task_status: 'completed', completed_at: '2030-01-01T00:00:00.000Z',
  retrospective: 'Preserved the result.', knowledge_dispositions: ['retrospective'],
};
expect(organizationLintIssues('Projects/Done.md', frontmatter, '- [ ] Still open\n')
  .map(issue => issue.code)).toContain('completed_work_with_open_checkboxes');
```

- [x] **Step 2: Run RED**

Run `npm test -- src/organization.test.ts -t "open Markdown tasks"`.
Expected: the new issue code is absent.

- [x] **Step 3: Implement the advisory lint**

Import `extractMarkdownTasks` in `src/organization.ts`. Inside the existing
`taskStatus === 'completed'` block, select at most the first 100 open tasks and
append one issue:

```ts
const openBodyTasks = extractMarkdownTasks(body, path)
  .filter(task => task.status === 'open')
  .slice(0, 100);
if (openBodyTasks.length > 0) {
  issues.push({
    code: 'completed_work_with_open_checkboxes',
    detail: `Completed work still contains ${openBodyTasks.length}${openBodyTasks.length === 100 ? '+' : ''} open Markdown task(s); first at line ${openBodyTasks[0]!.line}. Reopen the work, complete/remove obsolete boxes, or move real follow-ups explicitly.`,
  });
}
```

The parser returns no body text in the issue, keeping output bounded.

- [x] **Step 4: Run organization tests**

Run `npm test -- src/organization.test.ts`.
Expected: all organization tests pass.

- [x] **Step 5: Commit**

Commit `src/organization.ts` and `src/organization.test.ts` as
`feat: detect completed work with open markdown tasks`.

### Task 3: Route one bounded repair

- [x] **Step 1: Add a failing review-packet integration test**

In `src/llm-wiki.test.ts`, create one completed actionable note with a valid
retrospective plus one real open checkbox. Request `get_wiki_review_packet`
with `limit: 10, maxChars: 12000` and assert:

```ts
expect(packet.value.priorities).toEqual(expect.arrayContaining([
  expect.objectContaining({
    path: 'Projects/Completed with open task.md',
    priority: 2,
    reason: 'completed_work_with_open_checkboxes',
    suggestedTool: 'mcp.list_tasks',
  }),
]));
expect(packet.value.curationPlan).toMatchObject({
  inspect: {
    endpointId: 'mcp.list_tasks',
    arguments: { status: 'open', pathPrefix: 'Projects/Completed with open task.md', limit: 20, maxChars: 4000 },
  },
  then: {
    endpointId: 'wiki.triage',
    arguments: { path: 'Projects/Completed with open task.md', expectedRevision: expect.any(String) },
    requiredArguments: ['taskStatus'],
  },
  guard: { oneNotePerPlan: true, expectedRevisionRequired: true, autoFix: false },
});
```

Also reread the note and prove the checkbox and revision are unchanged.

- [x] **Step 2: Run RED**

Run `npm test -- src/llm-wiki.test.ts -t "routes completed notes with open Markdown tasks"`.
Expected: the issue remains generic lint debt and lacks the dedicated plan.

- [x] **Step 3: Add a failing bounded task-list test**

Extend `src/createServer.test.ts` with a task whose text is several thousand
characters. Call `list_tasks` with `maxChars: 512` and assert that the complete
JSON response fits, preserves `path`, `line`, and `taskId`, marks the text or
page truncated, and advertises `maxChars` in the tool schema.

- [x] **Step 4: Implement the bounded task-list projection**

Add `maxChars` to `list_tasks` with the shared 512--12000 range and a 4000
default. Project task text to a short preview, retain the stable locator, and
reduce the returned item count until the complete serialized envelope fits.
Keep `total`, `returned`, and `truncated` explicit. Do not alter task parsing or
the authoritative Markdown.

- [x] **Step 5: Add priority and curation routing**

In `LlmWikiService.reviewPacket`, add the lint code before generic lint debt:

```ts
add(lint.issues
  .filter(issue => issue.code === 'completed_work_with_open_checkboxes')
  .map(issue => ({ path: issue.path, title: issue.path.split('/').at(-1), issueCodes: [issue.code] })),
'completed_work_with_open_checkboxes', endpointIdForTool('list_tasks'), 2);
```

Add a curation-plan branch that inspects the exact path through
`endpointIdForTool('list_tasks')` with `maxChars: 4000`, then proposes
`endpointIdForTool('triage_wiki_note')` with the selected revision and
`requiredArguments: ['taskStatus']`. The instruction must state that the agent
may instead complete/remove an obsolete checkbox or move a follow-up, and that
no action is automatic.

- [x] **Step 6: Run task-list and Wiki integration tests**

Run `npm test -- src/createServer.test.ts src/llm-wiki.test.ts -t "task|routes completed notes with open Markdown tasks"`.
Expected: the dedicated route passes, remains within `maxChars`, and does not mutate the note.

- [x] **Step 7: Commit**

Commit `src/createServer.ts`, `src/createServer.test.ts`, `src/llm-wiki.ts`,
`src/llm-wiki.test.ts`, and this amended plan as
`feat: route completed checkbox inconsistencies`.

### Task 4: Teach the invariant progressively

- [x] **Step 1: Add failing policy assertions**

Update `src/wiki-policy.test.ts` to expect policy version 12 and require the
`work` topic to mention `open Markdown task` and `task_status: completed`.

- [x] **Step 2: Run RED**

Run `npm test -- src/wiki-policy.test.ts`.
Expected: version and guidance assertions fail.

- [x] **Step 3: Update bounded guidance**

Bump `WIKI_POLICY_VERSION` from 11 to 12. Add one `work` rule explaining that
completed structured work should contain no live Markdown checkbox tasks;
unfinished work should be reopened or moved explicitly and no checkbox is
changed automatically. Add matching concise paragraphs to README and schema.

- [x] **Step 4: Run guidance budgets**

Run `npm test -- src/wiki-policy.test.ts src/instruction-budget.test.ts`.
Expected: guidance and eager-instruction budgets pass.

- [x] **Step 5: Commit**

Commit policy, tests, README, and schema as
`docs: explain completed checkbox consistency`.

### Task 5: Verify and deliver the fork

- [x] **Step 1: Run focused suites**

Run `npm test -- src/markdown-tasks.test.ts src/filesystem.test.ts src/organization.test.ts src/llm-wiki.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts src/protocol-version.test.ts`.
Expected: all selected test files pass.

- [x] **Step 2: Build tracked distribution output**

Run `npm run build` and stage only tracked `dist/` changes with source changes.

- [x] **Step 3: Run the full suite**

Run `npm test`.
Expected: zero failures; any existing intentional skip remains visible.

- [x] **Step 4: Check repository hygiene**

Run `git diff --check` and `git status --short --branch`. Confirm `.agents/`
and `.mcpvault/` remain untracked and unstaged.

- [x] **Step 5: Commit generated output and completion record**

Commit the tracked build output and checked plan without staging local runtime
directories.

- [ ] **Step 6: Push and verify only the user fork**

Verify `origin` is `https://github.com/Song-Seng-Hun/mcpvault.git`, push
`main`, and compare `git ls-remote origin refs/heads/main` with `git rev-parse
HEAD`. Do not create a PR, tag, release, or upstream contribution.
