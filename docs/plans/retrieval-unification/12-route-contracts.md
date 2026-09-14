---
id: retrieval-route-contracts
kind: contract-inventory
description: Current route owners and compatibility constraints for the next adapter migration.
keywords: [profiles, scoped search, memory, fiction, MCP, REST, 검색경로]
use_when: Moving a search entry point into the common planner; inspect its tests first.
parent: README.md
previous: 11-baseline.md
next: status.md
---
# Route compatibility inventory
Static source inspection,2026-09-14. Not a route-parity execution certificate.
Access always comes from current authenticated scope policy, never query identity fields.

| Route | Current owner | Constraints to retain |
| --- | --- | --- |
| wiki.search | RetrievalService.searchNotes/retrieve | Logical projection; compact legacy results; skill discovery guards |
| wiki.search_scoped | CollaborationService.searchScopedNotes | Agent/model/community/global shadowing by logical path; lexical only |
| Situation | selectSituationCandidates -> memoryCandidates | Revision-bound admission;12hits,2activation slots;8safety slots reserved downstream |
| Layered memory | LayeredMemoryService -> memoryCandidates | Private candidate predicate, no candidate bodies; bounded later reads |
| Answer packet | QuestionPacketService -> retrieve | Factual domain, current locators, conditions/counterpoints, response budget |
| Source comparison | SourceComparisonService -> retrieve | Immutable input; candidate knowledge type; max8bodies; no automatic truth judgment |
| Research bridge | ResearchBridgeService -> retrieve | Main and contrast queries distinct; exclusions remain strict |
| Roleplay lore | RoleplayService -> retrieve | Explicit linked/revision-guarded lore only;fiction-only;semantic=false |
| Neighborhood | LlmWikiService -> semantic backend | Direct backend + metadata traversal remains a migration target |
| documents.search | DocumentSearch + RetrievalService | Structured-resource projections and original evidence differ from note previews |
| REST | Shared server runtime | Reuses endpoint dispatch; not a separate permission/ranking implementation |

## Migration constraints
Scoped search deduplicates by logical path before wiki/scope/order sorting.
Do not replace that precedence with RRF or collapse physical revisions into logical identity.
Memory's current10000metadata window is a compatibility limit, not a scalable implementation.
Situation's dynamic callback/revision lookup must become bounded residual checks or trusted IDs.
Never serialize a callback as an authoritative metadata filter.
Roleplay similarity cannot reveal unlinked lore; factual search must not absorb fiction.
Source comparison currently filters knowledge kind after discovery; move eligibility before top-k.
Missing indexed revisions cannot be replaced with freshly read hashes on stale excerpts.
Exact reads keep current access/revision checks without requiring a ready global search index.
Bare Welcome.md remains ambiguous with another folder's Welcome.md; it is not an exact root path.
Explicit qualified paths and selected link paths need separate fresh-source validation.

## Current correction only
query-policy.ts centralizes strict syntax, safe plain expansion and semantic eligibility.
General/evidence case-sensitive requests now match memory's lexical-only behavior.
Legacy exports and ranking remain; no full planner or new persistence contract is claimed.
Next batch needs behavioral route-parity tests before replacing scoped/neighborhood adapters.
Status computes manifest/pending counts outside request-specific admission; audit cost and scope leakage before exposing new diagnostics.
