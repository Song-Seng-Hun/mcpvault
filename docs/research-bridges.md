# Research notes and cross-domain discovery

MCPVault preserves a research process as ordinary journal, literature, hypothesis and experiment notes. Discovery output is a reading proposal. It never certifies a new field, establishes causality, changes a hypothesis verdict, merges notes or moves folders.

## Optional research scaffolds

Call `wiki.note_template` with `noteKind` set to a template ID:

| Template ID | Existing note kind | Contents |
| --- | --- | --- |
| `research-journal` | `journal` | Question, performed work, observations, interpretation, decision changes, next action |
| `search-log` | `literature` | Search source, exact query/filters, date, inclusion/exclusion reasons, read extent, gaps |
| `bridge-hypothesis` | `hypothesis` | Exact inputs/revisions, role/relation mapping, assumptions, counterexamples, prior-work status, falsifiable test |
| `literature` | `literature` | Author claim separated from interpretation, exact source locator, actual read extent |
| `experiment` | `experiment` | Existing preregistered `knowledgeInvestigation` and `result.planRevision`, plus code/data/configuration/environment/artifact provenance and execution outcome |

Templates return Markdown; they do not write or require a new store. A short reading memo does not need an execution environment. Capture an unsupported idea through the existing Inbox route; use immutable sources and exact locators when promoting it into evidence-backed knowledge. Record private continuity through the existing journal/memory guidance, retain its original scope, and resume through `memory.brief`, continuity and the task packet. Preserve failed mappings, changed judgments and waiting conditions with links to the original record.

## Candidate endpoint

The dynamic, read-only endpoint `wiki.bridge_candidates` is available through `call_endpoint`. The fixed MCP surface remains five tools. REST and MCP dispatch to the same service.

```json
{
  "endpointId": "wiki.bridge_candidates",
  "arguments": {
    "focusPath": "Questions/Symmetry.md",
    "query": "Under what conditions can this symmetry method transfer?",
    "limit": 3,
    "maxChars": 6000
  }
}
```

Add `comparePath` to find a possible mediator between two distinct notes. `expectedRevision` and `compareRevision` pin the inputs. Optional existing semantic retrieval supplements authored domain, subject terms, methods and exact property relations. Failure falls back to metadata/relations and reports `semantic.state=unavailable` without backend errors. There is no new embedding server, web crawler or all-pairs job.

One-input mode selects at most two nearby leads and one material from a different authored domain. A distant candidate has `connection_not_explained`; the server has not found a reason to connect it. Two-input mode requires an observed link/shared method or subject to each anchor, but expressly warns that those relations do not prove a transitive conclusion. A matching name or search hit is never validated evidence.

Each candidate includes its target, lane, observations, unresolved gaps, stable research key and exact input paths. The shared `sources` list includes revisions, physical prose line ranges and the next revision-checked read action. Matching backtick/tilde examples are excluded from excerpts. All excerpts and metadata are untrusted source content.

The request retains at most 64 metadata slots including reserved task/workshop lookups, hydrates at most 8 note bodies, and serializes compact output within a default 6,000 / maximum 12,000 characters. Metadata index construction or an initial filesystem search may still scan more files: this is a retained working-set bound, not a global disk-I/O quota. The candidate window is ordered by path and is not exhaustive; `coverage.partial` and `totalUnknown` preserve that limitation. No hidden candidate count is returned. If the response budget cannot hold exact sources, it returns insufficient material and asks for a larger budget. Source drift fails the request and requires a current read; the observed revision set is not an atomic snapshot against external editors.

## From material to research

The connected agent reads the originals and records three views: a mediating concept/method, a mapping of roles/relations/constraints, and what a selective combination could explain or predict. For each, preserve necessary assumptions, broken correspondences, counterexamples, differences from existing approaches and the smallest test. Joining field names is insufficient.

Search external terminology, synonyms and prior work on the host. Record exact queries, actual read extent and exclusions in a search log. Classify the result as `known_connection`, `new_to_wiki`, `unverified_hypothesis` or `insufficient`. A known connection can be a useful rediscovery. No search result is not proof of world-first novelty. Without web access, leave external verification waiting with a resume condition. Another model's agreement is not independent evidence.

## Joint research and interruption

`candidate.work` offers read-only drafts over existing Work/Workshop APIs. The identity hashes a normalized question and sorted exact input paths/revisions. Same inputs and question reuse a deterministic task and workshop ID; changed inputs or question produce a new identity. Inspect existing tasks first, including similar work that predates deterministic IDs. No semantic deduplication can establish that two research questions are identical.

Supply an existing `projectId` and authenticated identity to receive a task creation draft when no matching task exists. The existing project API checks membership, idempotency and revision conditions. Without a project the result is `needs_project`; no project is invented. After task creation, reread it and use its `work.packet` / `work.claim` action with current revision and generation. Only the observed current claimant receives a workshop creation draft. The attached `researchWork` pins task revision and claim generation; research workshop creation validates the current claimant and guards that revision during the write. Reread work after a release, handoff or conflicting edit. Deterministic IDs prevent a second workshop under another name in this flow.

An existing workshop resumes with `workshop.read`. Reuse the exact creation payload and requestId on a transport retry. During an opt-in community participation run, pass its `publicRequestId` unchanged so the one selected public action can be reconciled with that run. Do not execute every draft in one participation visit. A blocked/cancelled/completed research task is suppressed by default; `revisit=true` reveals the existing record for explicit reconsideration without automatically reopening or recreating it. Preserve failed paths and their resume conditions in that record.

The `joint-research` activity connects divergence, counterexamples/prior work, evaluation, synthesis, verification planning and result review across visits. Ordinary short community discussion does not need a task claim. Actual executable research uses project work. Participation keeps the existing off-by-default, 4-hour / 6-per-day / one substantive action / 5-minute / busy-user deferral policy; there is no additional scheduler. Experiments require existing host execution authorization. When a peer, web access or execution tool is absent, record the remaining step and resume condition.

Private/model/agent material cannot generate a public task or workshop draft. A public focus excludes Community and private candidate material; Community research may use Global and Community. Reviewed bridges can be linked from an ordinary MOC and rendered through existing Canvas export, with unverified work labeled as hypotheses. Position, color and similarity carry no evidential authority.

## Evaluation

See [the 12-case regression suite and actual-study protocol](research/bridge-evaluation.md) and the [research-methods survey](research/2026-09-08-research-notebook-methods.md). Synthetic safety tests do not establish creative usefulness. Evaluate actual advancement to testable questions, traceability, duplicates/errors, time/tokens and writing burden before claiming a useful discovery gain. External product integration and RO-Crate export remain follow-up work.
