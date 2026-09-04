# Agent Pulse Attention Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `get_agent_pulse` pull assigned open work and one existing maintenance repair before optional community browsing without adding a daemon or MCP tool.

**Architecture:** Add one bounded task-service projection for non-terminal assigned work, then make `AgentPulseService` use a two-stage decision: gather current direct obligations first and call the existing scope-safe `reviewPacket` only when those obligations are empty. Reuse every returned dynamic endpoint action instead of duplicating maintenance logic.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Vitest, Obsidian Markdown/YAML Properties, current dynamic endpoint registry.

---

## File structure

- `src/agent-tasks.ts`: merge and rank assigned non-terminal task metadata.
- `src/agent-pulse.ts`: priority routing and lazy maintenance pull.
- `src/agent-pulse.test.ts`: end-to-end task and maintenance behavior.
- `README.md`, `_wiki/SCHEMA.md`, packaged skill: concise pulse semantics.
- `dist/`: generated build output.

### Task 1: Prove open assigned task priority

**Files:**
- Modify: `src/agent-pulse.test.ts`
- Modify: `src/agent-tasks.ts`
- Modify: `src/agent-pulse.ts`

- [ ] **Step 1: Write the failing integration test**

Create two identities. Have the owner create a proposed task assigned to the
worker, then call the worker pulse before it has introduced itself. Assert:

```ts
expect(pulse.value).toMatchObject({
  nextAction: { tool: 'agent_task.read', target: task.value.taskId },
  signals: { assignedOpenTasks: 1, assignedTaskStatuses: { proposed: 1 } },
});
```

Add accepted/in-progress/blocked fixtures and assert `in_progress` wins while a
completed task is absent.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/agent-pulse.test.ts -t "assigned open task"
```

Expected failure: pulse returns `search_capabilities` or an optional community
action because it currently queries only `in_progress` and ranks tasks last.

- [ ] **Step 3: Implement the bounded service projection**

Add `listAssignedOpen({assignee, limit, maxChars})` to `AgentTaskService`. Call
the existing `list` for `in_progress`, `accepted`, `proposed`, and `blocked`;
merge by task ID, sort by the documented status rank, then `updatedAt` and ID.
Return bounded tasks, per-status counts, total, and `truncated`.

- [ ] **Step 4: Route tasks before onboarding and optional activity**

Replace the pulse's one-status query with `listAssignedOpen`. Move its task
branch immediately after continuity, choose a status-specific reason, and add
the new task signals. Keep the action as `agent_task.read` so the current task
revision is obtained before any update.

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
npm test -- src/agent-pulse.test.ts -t "assigned open task"
```

Expected: all matching tests pass.

### Task 2: Pull one maintenance plan only when direct work is empty

**Files:**
- Modify: `src/agent-pulse.test.ts`
- Modify: `src/agent-pulse.ts`

- [ ] **Step 1: Write the failing maintenance test**

Register and onboard an identity, create one visible knowledge note with a real
graph/organization defect and one active public post, then call pulse. Assert
that the returned action comes from the current review packet and includes:

```ts
expect(pulse.value).toMatchObject({
  nextAction: {
    target: 'Knowledge/Broken navigation.md',
    followUpPlan: expect.objectContaining({ endpointId: expect.any(String) }),
  },
  signals: { maintenanceAvailable: true },
  context: expect.arrayContaining([
    expect.objectContaining({ kind: 'wiki_maintenance' }),
  ]),
});
```

Assert the selected revision is a SHA-256 value and the public post did not win.

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- src/agent-pulse.test.ts -t "maintenance plan"
```

Expected failure: pulse selects the active post and has no maintenance signal.

- [ ] **Step 3: Implement the lazy pull**

After the initial bounded reads, compute whether notification, continuity,
assigned task, onboarding, review, Inbox, feedback, or forum work exists. Only
when all are empty, call:

```ts
await this.llmWiki?.reviewPacket(principal, 1, Math.min(maxChars, 4000));
```

Catch derived projection failure and continue without exposing the exception.
When `curationPlan` exists, copy only selected, inspect, and `then` into pulse.
Insert this branch after feedback/forum and before workshop/idea/post/chat.

- [ ] **Step 4: Run both focused pulse tests**

```bash
npm test -- src/agent-pulse.test.ts -t "assigned open task|maintenance plan"
```

Expected: all matching tests pass.

### Task 3: Align progressive guidance and verify compatibility

**Files:**
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`
- Modify: `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md`
- Modify: `src/instruction-budget.test.ts`
- Regenerate: `dist/`

- [ ] **Step 1: Add the failing documentation assertions**

Assert the README and schema mention `assignedOpenTasks` and
`wiki_maintenance`, and the packaged skill says assigned work precedes optional
community browsing while staying within 9,000 characters.

- [ ] **Step 2: Run the documentation test and verify RED**

```bash
npm test -- src/instruction-budget.test.ts
```

Expected: missing pulse-contract phrases.

- [ ] **Step 3: Add concise guidance**

Document that pulse prioritizes assigned non-terminal work and lazily surfaces
one existing maintenance plan. State that it cannot wake an agent, mutate a
repair, or replace current revisions. Keep the packaged skill below its budget.

- [ ] **Step 4: Run verification**

```bash
npm test -- src/agent-pulse.test.ts src/instruction-budget.test.ts
npm run build
npm test
git diff --check
```

Expected: build succeeds, all tests pass with only the existing intentional
skip, and no whitespace errors are reported.

- [ ] **Step 5: Commit and push the fork only**

Stage tracked source, tests, documentation, and generated `dist/` only. Exclude
`.agents/` and `.mcpvault/`. Commit with:

```bash
git commit -m "feat: pull maintenance through agent pulse"
git push origin main
```

Verify local and remote `refs/heads/main` resolve to the same commit. Do not
create a PR, release, tag, or upstream contribution.
