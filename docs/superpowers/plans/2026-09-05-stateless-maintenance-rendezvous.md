# Stateless Maintenance Rendezvous Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute equal-urgency idle maintenance work across authenticated agents without persistent claims, server session state, or public API expansion.

**Architecture:** Extend the internal review-packet method with an optional attention key, then use SHA-256 rendezvous scoring only inside the current minimum-priority band. Agent pulse derives that key from its existing principal-scoped cache identity and carries a compact non-exclusive routing card; the public endpoint omits the key and retains global ordering.

**Tech Stack:** TypeScript, Node.js crypto, MCP SDK, Vitest, existing review packet and pulse cache.

---

## File structure

- `src/llm-wiki.ts`: pure same-priority rendezvous selection and internal review option.
- `src/agent-pulse.ts`: authenticated key handoff and compact advisory routing card.
- `src/agent-pulse.test.ts`: per-identity distribution, priority-band/public-order
  invariants, visibility/snooze isolation, stability, and bounded output.
- `README.md`, `_wiki/SCHEMA.md`, packaged skill: concise non-exclusive semantics.
- `dist/`: generated output.

### Task 1: Prove equal-priority herd behavior

**Files:**
- Modify: `src/agent-pulse.test.ts`

- [x] **Step 1: Add a failing two-identity integration test**

Create at least eight global ordinary notes with one broken link each, onboard
two different authenticated model identities, and call each pulse. Assert both
actions are Wiki maintenance targets and differ:

```ts
expect(first.value.context).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: 'wiki_maintenance' }),
]));
expect(second.value.nextAction.target).not.toBe(first.value.nextAction.target);
```

Call the first pulse again without a Vault change and assert its target is
stable. Assert neither response contains an attention key.

- [x] **Step 2: Run RED**

```bash
npm test -- src/agent-pulse.test.ts -t "distributes equal-priority maintenance"
```

Expected: both identities receive the same globally first broken-link note.

### Task 2: Add internal rendezvous ordering

**Files:**
- Modify: `src/llm-wiki.ts`
- Verify through: `src/agent-pulse.test.ts`

- [x] **Step 1: Add the internal option and selector**

Implement the following shape next to the review packet:

```ts
interface ReviewPacketOptions { attentionKey?: string }

function rendezvousPriorityOrder<T extends { path: string; priority: number }>(
  priorities: T[], attentionKey?: string,
): { priorities: T[]; candidateBand: number } {
  if (!attentionKey || priorities.length < 2) return { priorities, candidateBand: priorities.length ? 1 : 0 };
  const minimum = priorities[0]!.priority;
  const band = priorities.filter(item => item.priority === minimum);
  if (band.length < 2) return { priorities, candidateBand: band.length };
  const selected = [...band].sort((left, right) =>
    hash(`${attentionKey}\0${right.path}`).localeCompare(hash(`${attentionKey}\0${left.path}`))
    || left.path.localeCompare(right.path))[0]!;
  return { priorities: [selected, ...priorities.filter(item => item !== selected)], candidateBand: band.length };
}
```

Collect the bounded unsnoozed candidate list before slicing the public result.
Apply this helper only when `options.attentionKey` is non-empty, then slice to
the requested result limit. Add the non-secret `attentionRouting` card.

- [x] **Step 2: Prove priority and public-order invariants**

In the pulse integration tests, assert a routed packet never selects a lower
numeric-priority item while higher-priority candidates exist, a one-candidate
band is unchanged, hidden/snoozed candidates do not enter the visible band,
and an ordinary MCP call has no `attentionRouting` property.

- [x] **Step 3: Run focused review tests**

```bash
npm test -- src/agent-pulse.test.ts -t "maintenance|distributes equal-priority maintenance"
```

Expected: routed priority tests pass and existing snooze tests remain green.

### Task 3: Wire authenticated pulse routing

**Files:**
- Modify: `src/agent-pulse.ts`
- Modify: `src/agent-pulse.test.ts`

- [x] **Step 1: Pass the existing principal cache key internally**

Change the review call to:

```ts
this.llmWiki?.reviewPacket(
  principal,
  1,
  MAINTENANCE_PACKET_MAX_CHARS,
  { attentionKey: key },
);
```

Extend `CompactMaintenancePlan` with a bounded routing card containing only
`mode`, `candidateBand`, and `exclusive`. Include it in maintenance context and
set `signals.maintenanceRouting` only when present. Do not include the key.

- [x] **Step 2: Clarify advisory semantics**

Update the maintenance action reason to state that deterministic distribution
reduces duplicate work but is not a lock, so the selected revision must be
re-read before mutation.

- [x] **Step 3: Run focused pulse tests**

```bash
npm test -- src/agent-pulse.test.ts -t "maintenance|distributes equal-priority maintenance"
```

Expected: distribution, cache invalidation, failure isolation, and 512-character
response tests pass.

### Task 4: Document, build, and deliver

**Files:**
- Modify: `README.md`
- Modify: `_wiki/SCHEMA.md`
- Modify: `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md`
- Regenerate: `dist/`

- [x] **Step 1: Add bounded documentation**

State that idle pulse uses stateless rendezvous routing only among equal
priority candidates, is advisory/non-exclusive, and retains revision checks.
Keep the packaged skill at or below its 9,000-character test budget.

- [x] **Step 2: Run complete verification**

```bash
npm run build
npm test
git diff --check
```

Expected: all tests pass with only the intentional skip and generated output is
current.

- [ ] **Step 3: Commit and push the fork**

```bash
git add -u
git add docs/superpowers/specs/2026-09-05-stateless-maintenance-rendezvous-design.md docs/superpowers/plans/2026-09-05-stateless-maintenance-rendezvous.md
git commit -m "feat: distribute maintenance across agents"
git push origin main
```

Verify `HEAD` equals `origin/main`; leave `.agents/` and `.mcpvault/` untracked.
Do not create a PR, release, tag, package publication, or upstream contribution.
