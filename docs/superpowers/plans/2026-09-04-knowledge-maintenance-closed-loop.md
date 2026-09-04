# Knowledge Maintenance Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close MCPVault's maintenance loop by requiring an explicit knowledge disposition at task completion, scheduling review by knowledge volatility, projecting bounded transitive invalidation, and producing explainable MOC rebalance plans.

**Architecture:** Keep Markdown, Properties, revisions, and Git authoritative. Put mutation validation in `AgentTaskService`, shared vocabulary in `organization.ts`, and request-local advisory projections in `LlmWikiService`; the MCP adapters remain thin and the fixed five-tool surface does not change. Reuse `ReferenceService`, scope access predicates, existing review graph semantics, and existing change-set endpoints rather than introducing a daemon, database, or automatic rewrite.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Vitest, Obsidian Markdown/YAML Properties, existing dynamic endpoint registry and npm build pipeline.

---

## File structure and responsibilities

- `src/agent-tasks.ts`: completion-disposition validation and persistence.
- `src/agent-task-tools.ts`: dynamic task endpoint schemas and guidance.
- `src/organization.ts`: volatility vocabulary, normalizer, Property contract, and manifest-facing constants.
- `src/llm-wiki.ts`: adaptive review calculation, cascade projection, and MOC rebalance planner.
- `src/llm-wiki-tools.ts`: review and rebalance endpoint schemas.
- `src/createServer.ts`: thin dispatch of new endpoint arguments.
- `src/endpoint-registry.ts`: dynamic endpoint IDs and discovery keywords.
- `src/agent-collaboration.test.ts`: task completion integration coverage.
- `src/organization.test.ts`: vocabulary and lint contract coverage.
- `src/llm-wiki.test.ts`: review cadence, cascade, MOC planner, bounds, and security coverage.
- `src/llm-wiki-tools.test.ts`, `src/createServer.test.ts`: schema, fixed-tool, discovery, and read-only coverage.
- `src/wiki-policy.ts`, `_wiki/SCHEMA.md`, `README.md`, and the packaged skill: progressive agent guidance.
- `dist/`: generated build output committed with source.

### Task 1: Require an explicit knowledge disposition on task completion

**Files:**
- Modify: `src/agent-collaboration.test.ts`
- Modify: `src/agent-tasks.ts:103-171`
- Modify: `src/agent-task-tools.ts:29-33`
- Modify: `src/createServer.ts:2136-2148`

- [ ] **Step 1: Write failing completion-gate tests**

In `src/agent-collaboration.test.ts`, add separate tests that:

```ts
const read = await json(client, 'read_agent_task', { taskId: task.value.taskId });
await expectJsonError(client, 'update_agent_task', {
  taskId: task.value.taskId,
  status: 'completed',
  reason: 'Work finished.',
  expectedRevision: read.value.revision,
  accessToken: agentToken,
}, 'knowledge disposition');
```

Then prove each accepted path independently:

```ts
retrospective: 'The reusable lesson is to verify the current revision before applying a patch.'
```

```ts
knowledgeNotes: ['Knowledge/Task completion lesson.md']
```

```ts
negativeKnowledgeNotes: ['Knowledge/Failed approaches/Blind retry.md']
```

```ts
noReusableKnowledge: true,
knowledgeDispositionReason: 'The task only acknowledged an already documented fact and produced no new reusable result.'
```

Assert `knowledge_dispositions` contains respectively `retrospective`,
`linked_knowledge`, `negative_knowledge`, or `no_reusable_knowledge`. Preserve
the existing useful combination of a retrospective plus linked knowledge and
assert both dispositions are recorded. Add a
stale-revision test proving the gate never bypasses concurrency. Add fixtures
for missing, ordinary non-knowledge, and private-scope paths and assert they all
fail without exposing a private physical path. Finally update an already
completed legacy fixture without a new status transition and prove it remains
compatible.

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- src/agent-collaboration.test.ts -t "knowledge disposition"
```

Expected: FAIL because completion currently accepts only `reason` and optional
retrospective/path strings.

- [ ] **Step 3: Add normalized disposition inputs**

Extend `AgentTaskService.update` with:

```ts
negativeKnowledgeNotes?: unknown;
noReusableKnowledge?: boolean;
knowledgeDispositionReason?: string;
```

Add a private validator that calls the existing reference boundary before
examining note roles:

```ts
private async validatedKnowledgeNotes(
  value: unknown,
  containerPath: string,
  principal: ScopePrincipal,
  expected: 'durable' | 'negative',
): Promise<string[] | undefined> {
  if (value === undefined) return undefined;
  const paths = await this.references.validateAndNormalize(value, containerPath, principal);
  if (paths.length === 0) return [];
  for (const path of paths.slice(0, 20)) {
    const note = await this.fileSystem.readNote(path);
    const isKnowledge = String(note.frontmatter.llm_wiki_type || '').toLowerCase() === 'knowledge';
    const isNegative = String(note.frontmatter.knowledge_polarity || '').toLowerCase() === 'negative';
    if (!isKnowledge || (expected === 'negative' ? !isNegative : isNegative)) {
      throw new Error(`All ${expected === 'negative' ? 'negativeKnowledgeNotes' : 'knowledgeNotes'} must identify visible public ${expected === 'negative' ? 'negative ' : ''}knowledge notes`);
    }
  }
  return paths.slice(0, 20);
}
```

Because `ReferenceService.canReferenceFrom` checks the public task container,
private paths are rejected before persistence. Catch reference validation errors
for these two fields and replace them with the same generic role error so hidden
existence is not disclosed.

- [ ] **Step 4: Enforce the transition gate before writing**

Compute:

```ts
const entersCompleted = previousStatus !== 'completed' && status === 'completed';
const noReusableKnowledge = params.noReusableKnowledge === true;
const dispositionReason = params.knowledgeDispositionReason === undefined
  ? undefined
  : shortText(params.knowledgeDispositionReason, 'knowledgeDispositionReason', 1000);
const knowledgeDispositions = [
  ...(knowledgeNotes?.length ? ['linked_knowledge'] : []),
  ...(negativeKnowledgeNotes?.length ? ['negative_knowledge'] : []),
  ...(retrospective ? ['retrospective'] : []),
  ...(noReusableKnowledge ? ['no_reusable_knowledge'] : []),
];
if (entersCompleted && knowledgeDispositions.length === 0) {
  throw new Error('Completing a task requires a knowledge disposition: provide knowledgeNotes, negativeKnowledgeNotes, retrospective, or noReusableKnowledge=true with knowledgeDispositionReason');
}
if (noReusableKnowledge && !dispositionReason) {
  throw new Error('knowledgeDispositionReason is required when noReusableKnowledge=true');
}
if (noReusableKnowledge && knowledgeDispositions.some(value => value !== 'no_reusable_knowledge')) {
  throw new Error('noReusableKnowledge cannot be combined with retrospective or knowledge note artifacts');
}
```

Persist the bounded normalized `knowledge_dispositions` list, the bounded
reason, and the appropriate path lists. Do not remove historical values on unrelated
updates. Return the disposition and resulting revision.

- [ ] **Step 5: Extend the dynamic schema and adapter**

Add the three inputs to `update_agent_task` and change its description from
“optional” retrospective to the four-choice completion rule. Pass the values
unchanged from `createServer.ts` into `AgentTaskService.update`.

- [ ] **Step 6: Run the focused tests and verify GREEN**

```bash
npm test -- src/agent-collaboration.test.ts src/createServer.test.ts -t "knowledge disposition|read-only"
```

Expected: PASS; task mutation remains rejected in read-only mode.

- [ ] **Step 7: Commit**

```bash
git add src/agent-collaboration.test.ts src/agent-tasks.ts src/agent-task-tools.ts src/createServer.ts
git commit -m "feat: require task knowledge disposition"
```

### Task 2: Add volatility-aware adaptive review

**Files:**
- Modify: `src/organization.test.ts`
- Modify: `src/llm-wiki.test.ts`
- Modify: `src/organization.ts:10-70,141-220,430-650`
- Modify: `src/llm-wiki.ts:728-735` and the publish/review paths
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/createServer.ts`

- [ ] **Step 1: Write failing vocabulary, lint, and scheduling tests**

Assert the organization contract contains:

```ts
expect(VOLATILITY_CLASSES).toEqual(['ephemeral', 'evolving', 'durable', 'foundational']);
expect(getOrganizationPropertyContract()).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: 'volatility_class', allowed: VOLATILITY_CLASSES }),
]));
```

Publish one note per class, review each as `confirmed`, and assert intervals
`7`, `30`, `90`, and `365`. Seed prior intervals at each cap and prove another
confirmation does not exceed `30`, `180`, `730`, and `3650`. Verify `disputed`
is always 7, `revised` is no more than 14 or the class default, an explicit
`nextReviewAt` wins, and `valid_until`/upstream triggers can still make a note
due early. Directly author `volatility_class: chaotic` and assert lint reports
the managed Property violation.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/organization.test.ts src/llm-wiki.test.ts -t "volatility|adaptive review"
```

Expected: FAIL because the vocabulary and class-sensitive scheduler are absent.

- [ ] **Step 3: Add one shared vocabulary and normalizer**

In `src/organization.ts`:

```ts
export const VOLATILITY_CLASSES = ['ephemeral', 'evolving', 'durable', 'foundational'] as const;
const volatilityClassSet = new Set<string>(VOLATILITY_CLASSES);

export function normalizeVolatilityClass(value: unknown, fallback?: typeof VOLATILITY_CLASSES[number]) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!volatilityClassSet.has(normalized)) {
    throw new Error(`volatilityClass must be one of: ${VOLATILITY_CLASSES.join(', ')}`);
  }
  return normalized as typeof VOLATILITY_CLASSES[number];
}
```

Add `volatility_class` to the Property contract and the write/schema mapping.
Do not duplicate allowed values in tool schemas; derive enums from the constant.

- [ ] **Step 4: Replace the legacy scheduler with a class-aware helper**

Use:

```ts
const VOLATILITY_REVIEW = {
  ephemeral: { initial: 7, maximum: 30 },
  evolving: { initial: 30, maximum: 180 },
  durable: { initial: 90, maximum: 730 },
  foundational: { initial: 365, maximum: 3650 },
} as const;

function adaptiveReviewIntervalDays(frontmatter: Record<string, any>, outcome: string): number {
  const volatility = normalizeVolatilityClass(frontmatter.volatility_class, 'evolving')!;
  const cadence = VOLATILITY_REVIEW[volatility];
  const previous = Number(frontmatter.review_interval_days);
  const validPrevious = Number.isInteger(previous) && previous > 0;
  if (outcome === 'disputed') return 7;
  if (outcome === 'revised') return Math.min(14, cadence.initial);
  if (outcome === 'rescheduled') return validPrevious ? Math.min(previous, cadence.initial) : cadence.initial;
  if (outcome === 'confirmed') return validPrevious ? Math.min(previous * 2, cadence.maximum) : cadence.initial;
  return cadence.initial;
}
```

Normalize `volatilityClass` on publish/update, persist it as
`volatility_class`, and expose it in review results. Preserve explicit
`nextReviewAt` precedence.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/organization.test.ts src/llm-wiki.test.ts src/llm-wiki-tools.test.ts -t "volatility|adaptive review|property contract"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/organization.ts src/organization.test.ts src/llm-wiki.ts src/llm-wiki.test.ts src/llm-wiki-tools.ts src/llm-wiki-tools.test.ts src/createServer.ts
git commit -m "feat: schedule reviews by knowledge volatility"
```

### Task 3: Project bounded transitive upstream invalidation

**Files:**
- Modify: `src/llm-wiki.test.ts`
- Modify: `src/llm-wiki.ts:1462-1565,2958-3060` and impact-report code
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/createServer.ts`

- [ ] **Step 1: Write failing cascade tests**

Create visible notes `A <- B <- C` using `derived_from`, set B and C to
`review_policy: on_upstream_change`, then revise A. Assert:

```ts
expect(queue.value.items).toEqual(expect.arrayContaining([
  expect.objectContaining({
    path: 'Knowledge/C.md',
    reviewTriggers: expect.arrayContaining(['upstream_cascade_changed']),
    cascade: expect.objectContaining({ depth: 2 }),
  }),
]));
expect(queue.value.items.find((item: any) => item.path === 'Knowledge/C.md').cascade.path)
  .toEqual(['Knowledge/A.md', 'Knowledge/B.md', 'Knowledge/C.md']);
```

Add tests for a four-node cycle, a `maxCascadeDepth: 1` request, `maxChars: 700`,
and a private B bridge. The private bridge must not reveal B, affect visible
counts, or create a chain for C. Add a note without `on_upstream_change` and
prove it is not transitively enrolled.

- [ ] **Step 2: Run and verify RED**

```bash
npm test -- src/llm-wiki.test.ts -t "cascade upstream"
```

Expected: FAIL because only direct baselines are inspected.

- [ ] **Step 3: Build one request-local propagation graph**

Add private types:

```ts
interface UpstreamCascadeSignal {
  path: string[];
  revisions: string[];
  depth: number;
  origin: string;
  directChanges: string[];
}
```

Add `collectUpstreamCascadeSignals(principal, maxDepth, maxNodes)` that:

1. scans only visible, non-moderated knowledge notes;
2. builds the existing knowledge reference index once;
3. resolves explicit review-upstream edges with the existing direction rules;
4. computes direct changed seeds through `reviewChangeSignals`;
5. performs cycle-safe BFS over reverse dependency edges;
6. enrolls only dependents whose policy is `on_upstream_change`;
7. keeps the shortest deterministic chain per path; and
8. stops at `maxDepth`, `maxNodes`, and a fixed edge ceiling.

Use normalized physical paths internally. Convert to public paths only after
visibility has been checked. Do not persist the graph or cache it by principal.

- [ ] **Step 4: Merge cascade reasons into bounded projections**

Extend `reviewQueue` inputs with `maxCascadeDepth` default 3 and maximum 6.
Build the cascade map once before the scan. For a mapped note add
`upstream_cascade_changed`, score it below direct upstream change, and return a
compact chain with revisions. Extend the existing impact report with the same
input and result shape so both views agree.

Trim chains before dropping selected items when enforcing `maxChars`. Return
`cascadeTruncated` separately from ordinary output truncation.

- [ ] **Step 5: Extend endpoint schemas and adapters**

Add:

```ts
maxCascadeDepth: {
  type: 'integer',
  minimum: 1,
  maximum: 6,
  default: 3,
  description: 'Maximum explicit upstream dependency depth for request-local invalidation projection.',
}
```

to review queue and impact report tools, then pass it through
`createServer.ts`. No mutation or fixed MCP tool is added.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm test -- src/llm-wiki.test.ts src/llm-wiki-tools.test.ts -t "cascade upstream|review queue|impact report"
```

Expected: PASS with bounded cycle-safe output and no hidden path.

- [ ] **Step 7: Commit**

```bash
git add src/llm-wiki.ts src/llm-wiki.test.ts src/llm-wiki-tools.ts src/llm-wiki-tools.test.ts src/createServer.ts
git commit -m "feat: project cascading upstream review"
```

### Task 4: Add an explainable MOC rebalance endpoint

**Files:**
- Modify: `src/llm-wiki.test.ts`
- Modify: `src/llm-wiki-tools.test.ts`
- Modify: `src/createServer.test.ts`
- Modify: `src/llm-wiki.ts` near `mocCandidates` and `learningPath`
- Modify: `src/llm-wiki-tools.ts`
- Modify: `src/createServer.ts`
- Modify: `src/endpoint-registry.ts`

- [ ] **Step 1: Write failing planner tests**

Create an overloaded MOC with ordered links under `## Foundations`,
`## Operations`, and `## Open questions`; include shared `domain` and
`subject_terms`, one unresolved link, and a prerequisite crossing two headings.
Call the wished-for internal tool and assert:

```ts
const plan = await callJson(client, 'get_wiki_moc_rebalance', {
  path: 'Knowledge/MOCs/Large.md',
  maxBranches: 4,
  limit: 30,
  maxChars: 8000,
  accessToken,
});
expect(plan.value).toMatchObject({
  mode: 'explainable_moc_rebalance_plan',
  root: { path: 'Knowledge/MOCs/Large.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
  mutates: false,
});
expect(plan.value.branches[0]).toMatchObject({
  basis: 'authored_heading',
  heading: 'Foundations',
  entries: expect.any(Array),
});
expect(plan.value.crossBranchDependencies).toEqual(expect.arrayContaining([
  expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
]));
```

Assert entry order equals source line order, all entries carry revisions, the
unresolved link is bounded, leftovers are explicit, `maxBranches` and
`maxChars` hold, a private target is absent, and a root revision change during
planning returns a retryable error. A small healthy MOC should return
`rebalanceRecommended: false` rather than fabricate branches.

- [ ] **Step 2: Run and verify RED**

```bash
npm test -- src/llm-wiki.test.ts -t "MOC rebalance"
```

Expected: FAIL because the endpoint is absent.

- [ ] **Step 3: Implement deterministic authored-first grouping**

Add:

```ts
async mocRebalance(
  principal: ScopePrincipal | undefined,
  path: string,
  maxBranches = 4,
  limit = 30,
  maxChars = 8000,
)
```

Clamp branches to 2..5, entries to 1..50, and output to 700..16000. Read and
validate the root as `note_kind: moc`. Use fence-aware
`extractObsidianLinkOccurrences` so examples do not become entries. Resolve
each direct occurrence with the caller access predicate; retain line, authored
heading context, target revision, `domain`, `subject_terms`, typed relations,
and child-MOC metadata.

Group entries first by authored heading when a heading has at least two visible
entries. Place existing child MOCs next. For remaining entries use an exact
shared typed-relation neighborhood, then exact normalized domain/subject facet;
never use folder proximity or semantic similarity as membership proof. Put all
other entries in `Unclassified` without guessing. Preserve source-line order
inside every branch and order branches by their first source line.

Use the existing graph relation resolver to report visible dependencies whose
endpoints fall in different branches. Return only revision-stamped plans that
route through `wiki.moc_membership`, `wiki.hierarchy_change`, and a dry-run
`notes.change_set`; do not generate an executable confirmed change set.

Re-read the root before returning and fail if its revision changed. Remove
entry excerpts and then trim diagnostic arrays/branches until the serialized
response fits `maxChars`.

- [ ] **Step 4: Register one read-only dynamic endpoint**

Add internal tool `get_wiki_moc_rebalance` with schema:

```ts
{
  path: { type: 'string', description: 'Visible MOC note path.' },
  maxBranches: { type: 'integer', minimum: 2, maximum: 5, default: 4 },
  limit: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
  maxChars: { type: 'integer', minimum: 700, maximum: 16000, default: 8000 },
  accessToken,
  prettyPrint,
}
```

Map it to `wiki.moc_rebalance`, dispatch it in `createServer.ts`, mark it
read-only in the capability model, and add discovery terms `overloaded MOC`,
`split map`, `rebalance`, and `sub-MOC`. Assert the production MCP tool list is
still exactly the fixed five.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/llm-wiki.test.ts src/llm-wiki-tools.test.ts src/createServer.test.ts -t "MOC rebalance|fixed five|capabilit"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm-wiki.ts src/llm-wiki.test.ts src/llm-wiki-tools.ts src/llm-wiki-tools.test.ts src/createServer.ts src/createServer.test.ts src/endpoint-registry.ts
git commit -m "feat: plan explainable MOC rebalancing"
```

### Task 5: Publish organization contract v7 and progressive guidance

**Files:**
- Modify: `src/llm-wiki.test.ts`
- Modify: `src/wiki-policy.test.ts`
- Modify: `src/instruction-budget.test.ts`
- Modify: `src/llm-wiki.ts` manifest code
- Modify: `src/wiki-policy.ts`
- Modify: `_wiki/SCHEMA.md`
- Modify: `README.md`
- Modify: `plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md`

- [ ] **Step 1: Write failing manifest and policy tests**

Expect manifest version 7 and:

```ts
reviewCadence: {
  volatilityProperty: 'volatility_class',
  classes: ['ephemeral', 'evolving', 'durable', 'foundational'],
  explicitDatesPrecedeDefaults: true,
  cascade: 'bounded_explicit_upstream_projection',
}
```

Verify version 6 comparison reports a reviewed migration rather than silently
assuming cadence compatibility. Assert `work` policy names all four task
dispositions, `review` explains volatility and cascade as advisory, and `moc`
routes to `wiki.moc_rebalance`. Keep every topic inside its existing bounded
character contract and the packaged skill below its instruction budget.

- [ ] **Step 2: Run and verify RED**

```bash
npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts -t "manifest|knowledge disposition|volatility|rebalance|instruction"
```

Expected: FAIL on manifest version/contract and missing guidance.

- [ ] **Step 3: Extend the portable manifest**

Bump `manifestVersion` from 6 to 7 and include the normalized `reviewCadence`
object above in the comparable fingerprint. Older manifests remain readable but
produce `missing_review_cadence_contract`; conflicting v7 class order or cascade
semantics produce a blocking `review_cadence_contract_conflict`. Scope and
provenance rules are unchanged.

- [ ] **Step 4: Update bounded policy and docs**

Increment the policy version. Add only the action-relevant rules:

- `work`: completing a task requires at least one auditable disposition; useful
  artifacts may be combined while `no_reusable_knowledge` is exclusive;
- `review`: explicit dates/events win over volatility defaults and cascade is a
  current-revision review prompt, not an automatic truth or lifecycle change;
- `moc`: use `wiki.moc_rebalance` only after an overload warning and inspect the
  authored heading/order basis before applying existing revision-safe actions.

Document the Property example, four completion options, cascade bounds, and
planner usage in README and schema. Keep onboarding compact; the packaged skill
points agents to the one relevant policy topic instead of embedding the whole
contract.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm test -- src/llm-wiki.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts src/llm-wiki-tools.test.ts -t "manifest|knowledge disposition|volatility|rebalance|instruction|policy"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm-wiki.ts src/llm-wiki.test.ts src/wiki-policy.ts src/wiki-policy.test.ts src/instruction-budget.test.ts _wiki/SCHEMA.md README.md plugins/mcpvault-local/skills/mcpvault-agent/SKILL.md
git commit -m "docs: publish maintenance closed-loop contract v7"
```

### Task 6: Verify generated output and deliver only to the fork

**Files:**
- Modify: `dist/` generated output
- Verify: all source, tests, docs, and Git state

- [ ] **Step 1: Run all affected suites**

```bash
npm test -- src/agent-collaboration.test.ts src/organization.test.ts src/llm-wiki.test.ts src/llm-wiki-tools.test.ts src/createServer.test.ts src/wiki-policy.test.ts src/instruction-budget.test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Build committed distribution output**

```bash
npm run build
```

Expected: exit 0 and generated `dist/` reflects source.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: zero failed tests.

- [ ] **Step 4: Check repository hygiene**

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; `.agents/` and `.mcpvault/` remain untracked and
unstaged; no credentials, caches, releases, tags, or unrelated files are added.

- [ ] **Step 5: Commit generated output when changed**

```bash
git add dist
git commit -m "build: refresh maintenance closed-loop distribution"
```

Do not create an empty commit when build output is unchanged.

- [ ] **Step 6: Verify destination and push only the authorized fork**

```bash
git remote get-url origin
git branch --show-current
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Expected: origin is `https://github.com/Song-Seng-Hun/mcpvault.git`, branch is
`main`, and local/remote hashes match. Do not create a pull request, release,
tag, package publication, or upstream mutation.
