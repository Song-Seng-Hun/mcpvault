# Knowledge Maintenance Closed Loop

Date: 2026-09-04
Status: Approved for autonomous implementation

## Purpose

MCPVault already provides evidence review, upstream baselines, promotion
candidates, MOC learning paths, graph health, and revision-safe writes. The
remaining gap is not another dashboard: the pieces do not yet form a closed
loop. A task can finish without explicitly disposing of its reusable learning,
all knowledge shares one adaptive review curve, an unchanged intermediate note
can hide a changed transitive premise, and an overloaded MOC produces only a
generic warning.

This change closes those loops while retaining ordinary Obsidian Markdown,
YAML Properties, current revisions, and Git as authority. Derived queues and
plans remain bounded advisory views. The only new hard gate occurs at a
deliberate task-completion transition, where the actor must state what happened
to reusable knowledge.

## Goals

- Prevent silent loss of reusable learning when an agent task is completed.
- Give fast-changing and foundational knowledge different default review
  cadences without overriding explicit dates or event policies.
- Surface bounded transitive upstream invalidation without mass-mutating notes.
- Turn an overloaded MOC warning into an explainable, revision-stamped split
  proposal that preserves authored order and headings.
- Keep the fixed MCP surface at five tools and expose new behavior only through
  dynamic endpoint IDs or existing endpoints.
- Preserve scope non-disclosure, revision safety, output bounds, and read-only
  behavior.

## Non-goals

- Requiring every completed task to publish a new durable note.
- Treating a retrospective as verified factual evidence.
- Automatically changing lifecycle, relations, MOC membership, or Markdown.
- Inferring invalidation from ordinary proximity or semantic similarity.
- Replacing explicit `review_at`, `valid_until`, or event-driven review rules.
- Running a separately installed daemon, vector model, client helper, or
  background writer.
- Clustering a MOC solely from embeddings or silently rewriting its narrative.

## 1. Task completion knowledge-disposition gate

`mcp.update_task` keeps its existing revision and ownership checks. A transition
from any non-terminal state to `completed` must additionally provide one valid
knowledge disposition:

1. one or more visible, existing durable `knowledgeNotes`;
2. a non-empty `retrospective` suitable for later promotion review;
3. one or more visible, existing negative-knowledge notes; or
4. `noReusableKnowledge: true` plus a bounded `knowledgeDispositionReason`.

The gate records a normalized `knowledge_disposition` value and, when used,
`knowledge_disposition_reason`. Existing completed tasks remain readable and
editable under existing rules; the gate applies only to a new transition into
`completed`. Repeating an update while already completed does not retroactively
invalidate history.

`knowledgeNotes` and negative-knowledge references are not trusted as path
strings. Each path must normalize safely, exist, be visible to the principal,
resolve to a knowledge note, and carry an appropriate durable or negative role.
An invalid or hidden target produces one generic actionable error and never
reveals whether a hidden path exists. Duplicate paths are removed and all lists
remain bounded.

A retrospective is experiential context, not evidence. Promotion candidates
continue to require source grounding before factual publication. The explicit
`no_reusable_knowledge` escape hatch prevents ceremonial empty notes while
making the decision auditable.

## 2. Volatility-aware review cadence

Add one optional controlled Property:

```yaml
volatility_class: ephemeral | evolving | durable | foundational
```

Meaning:

- `ephemeral`: versions, APIs, prices, live service behavior, and other rapidly
  changing observations;
- `evolving`: operating practices, tools, policies, and active research;
- `durable`: established designs, patterns, and repeatedly confirmed models;
- `foundational`: definitions, mathematics, logic, and intentionally stable
  first principles.

The class influences only the default and maximum interval chosen by adaptive
review after an outcome:

| Class | Initial confirmed interval | Maximum confirmed interval |
| --- | ---: | ---: |
| ephemeral | 7 days | 30 days |
| evolving | 30 days | 180 days |
| durable | 90 days | 730 days |
| foundational | 365 days | 3650 days |

`disputed` remains 7 days. `revised` uses the smaller of 14 days and the class
default. `rescheduled` preserves a shorter authored interval and otherwise uses
the class default. `confirmed` doubles a valid prior interval up to the class
cap, or starts at the class default.

Precedence is explicit and stable:

1. caller-supplied next review date;
2. authored `review_interval_days` as the previous adaptive input;
3. `volatility_class` defaults and caps;
4. the legacy evolving defaults when no class is authored.

`valid_until`, source/link/edit/upstream event policies, disputed status, and
summary staleness can still trigger review earlier. Foundational does not mean
infallible or exempt from event-based invalidation.

The Property contract, normalizers, publish/review schemas, lint, progressive
policy, manifest, and documentation use one shared vocabulary. Unknown or
wrong-shaped values are warnings/errors according to the existing managed
Property contract; custom Properties remain valid.

## 3. Bounded transitive upstream invalidation

Direct upstream baselines remain the authored per-note record. A derived
request-local propagation pass augments review and impact projections:

- Seed notes are those whose direct `on_upstream_change` baseline reports a
  changed prerequisite.
- Propagation follows only explicit downstream dependency semantics already
  recognized by review: `derived_from`, `depends_on`, `version_of`, `refines`,
  and correctly directed `supports`.
- A dependent note is included only when it explicitly opts into
  `review_policy: on_upstream_change`.
- The projection records the visible path from the original changed premise to
  the dependent, depth, originating direct signal, and current revisions.
- Default depth is 3, hard maximum 6. Traversal has hard node/edge ceilings and
  all serialized output still obeys `limit` and `maxChars`.
- Cycles are detected, reported compactly, and never cause repeated work.
- Visibility filtering occurs before seeding, traversal, counts, path details,
  and truncation metadata. A hidden bridge cannot reveal hidden identities or
  create a visible explanation containing them.

The review queue uses `upstream_cascade_changed` as an additional reason and
scores it below a direct upstream change. The impact report exposes the same
bounded chain. Neither endpoint changes lifecycle or writes a baseline. A
completed review of the dependent refreshes its direct baseline; later queue
results are always recomputed from current Markdown and revisions.

## 4. Explainable MOC rebalance planner

Add a read-only dynamic endpoint `wiki.moc_rebalance`. It accepts one MOC path,
optional `maxBranches`, `limit`, and `maxChars`. The endpoint is discoverable
through `search_capabilities`; it does not add a fixed MCP tool.

The planner first verifies that the target is a visible MOC and captures its
current revision. It resolves only direct authored body entries and preserves
their exact order, heading context, link line, and current target revision.
Unresolved, ambiguous, hidden, or non-note entries are reported only in bounded
non-disclosing form.

A plan is useful when the MOC exceeds the existing graph-degree threshold or a
single authored section is itself overloaded. Candidate branches are built in
this explainable order:

1. authored heading sections with at least two resolved entries;
2. existing child MOCs and `moc_parent` hierarchy;
3. shared typed prerequisite/relation neighborhoods;
4. shared `domain` or `subject_terms` facets;
5. a deterministic `Unclassified` remainder that remains visible instead of
   being guessed into another branch.

Semantic similarity may be returned later as a labeled low-confidence hint but
is not required by this design and never creates membership on its own.

The response returns:

- the root path and revision;
- overload measurements and threshold;
- two to five ordered branch candidates;
- each branch's basis, entries, entry revisions, and source lines/headings;
- cross-branch dependencies and entries that resist safe grouping;
- a dry-run-oriented sequence using existing `wiki.moc_membership`,
  `wiki.hierarchy_change`, and `notes.change_set` endpoints;
- an explicit warning that authored Markdown order remains authoritative.

The endpoint never writes a MOC, invents links, or claims the proposal is a
truth partition. A caller must re-read the root and targets, dry-run the exact
revision-stamped changes, and confirm them through existing mutation endpoints.

## Architecture and boundaries

- `src/agent-tasks.ts` owns task disposition validation and persistence.
- `src/organization.ts` owns the volatility vocabulary and Property contract.
- `src/llm-wiki.ts` owns adaptive review, derived cascade projection, and MOC
  rebalance planning.
- `src/agent-task-tools.ts` and `src/llm-wiki-tools.ts` describe bounded dynamic
  endpoint inputs and actionable completion errors.
- `src/createServer.ts` remains a thin adapter; it must not duplicate business
  rules.
- `src/endpoint-registry.ts` adds discovery metadata only.
- Existing filesystem, path filter, scope access, graph, and reference services
  remain the normalization and visibility boundaries.
- No principal-specific persistent cache is introduced. Request-local graph
  structures are disposable and bounded.

## Error handling

- Completion without a disposition returns an actionable error listing the four
  valid choices and does not write the task.
- Hidden/nonexistent/invalid knowledge references share one error form.
- Invalid volatility values are rejected by managed write schemas and reported
  by lint when authored directly in Markdown.
- A MOC changed during planning returns a retryable re-read message.
- Traversal or response limits set `truncated: true` and report applied bounds;
  they never silently imply whole-Vault completeness.
- Index or semantic subsystem failure cannot prevent task completion checks,
  review queue reads, or heading/facet-based MOC planning.

## Compatibility and migration

- Existing tasks and knowledge notes require no eager rewrite.
- Existing completed task history remains valid.
- Notes without `volatility_class` retain the current evolving adaptive review
  behavior.
- Existing direct upstream reasons remain unchanged; cascade reasons are
  additive.
- Existing MOC health and learning-path responses remain valid. The new planner
  is an optional drill-down from their overload warning.
- No extra client installation, daemon, plugin configuration, or REST helper is
  required.

## Security invariants

- Paths are normalized and checked through the caller's access predicate before
  existence-dependent details are returned.
- Hidden nodes do not affect visible counts, branch membership, cascade chains,
  collision details, or error wording.
- Note bodies and metadata are untrusted content and never executable guidance.
- All arrays, strings, traversals, and result objects are bounded.
- The new MOC endpoint is read-only. Existing task mutation remains in the
  read-only rejection set and requires authentication, capability, ownership,
  and `expectedRevision`.
- No automatic Git commit, lifecycle transition, note publication, relation
  rewrite, or MOC split is introduced.

## Acceptance criteria

1. A new transition to completed fails atomically without one valid disposition.
2. Each valid disposition succeeds, persists an explicit normalized state, and
   preserves the existing revision/ownership checks.
3. Hidden, missing, wrong-role, traversal, and duplicate knowledge-note inputs
   are handled without scope disclosure or unbounded work.
4. All four volatility classes produce the documented adaptive defaults/caps;
   explicit dates and earlier event triggers retain precedence.
5. Property schemas, lint, policy, manifest, and docs agree on the vocabulary.
6. Direct upstream behavior remains intact while a two- or three-hop explicit
   dependency can enter the review queue with a bounded visible chain.
7. Cycles, depth limits, output limits, and hidden bridges cannot loop, explode
   context, or leak paths.
8. `wiki.moc_rebalance` preserves authored order and heading provenance, returns
   deterministic bounded branches, reports leftovers/cross-branch edges, and
   never writes.
9. Capability search discovers the new endpoint while the fixed MCP surface
   remains exactly five tools.
10. Read-only mode still rejects task mutation and allows all new projections.
11. Targeted tests, build, full tests, and `git diff --check` pass; generated
    `dist/` matches source.

## Documentation

Update `README.md`, `_wiki/SCHEMA.md`, the `work`, `review`, and `moc`
progressive policy topics, and the packaged MCPVault skill. Guidance must tell
agents that task completion requires a disposition, volatility is a scheduling
hint rather than truth, cascade results are review prompts, and rebalance plans
must be inspected and applied through revision-safe existing endpoints.

## Delivery boundary

Commit and push only to `Song-Seng-Hun/mcpvault` branch `main`. Do not create a
pull request, release, tag, package publication, or upstream contribution.
