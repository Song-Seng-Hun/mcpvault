---
id: retrieval-contracts
kind: implementation-plan
description: Shared contracts and current adapter migration map.
keywords: [contracts, profiles, adapters, 통일화]
parent: README.md
previous: README.md
next: 02-candidates.md
---
# Contracts and routes
Use: R0 inventory and R1 adapters. Not: uniform ranking across different purposes.
RetrievalService remains the public entry point.
Split internals into src/retrieval/ plan, candidates, ranking, evidence and delivery.
Flow: parse -> authorize -> condition -> select route -> candidates -> fuse -> verify -> budget.
Define RetrievalPlan, CandidatePage and EvidencePacket.
Carry condition provenance, generations, revisions, channel ranks and incomplete coverage.
DiscoveryCard is not Evidence; source-family duplication grants no additional corroboration.
Preserve profiles for factual/fictional, private memory, strict syntax and legacy ordering.
Share enforcement; do not collapse purpose-specific ordering or response defaults.
Exact read/export bypass retrieval but still check current access and revision.
Architecture checks forbid direct backend calls and duplicate fusion/caps outside owners.
Large services retain wiring only; MCP and REST call the same service operations.

## R0 static migration map
- retrieval-service.ts: existing common search and evidence fusion.
- context-selection.ts: situation candidates via memoryCandidates.
- layered-memory.ts: memoryCandidates; preserve private-memory semantics.
- question-packet.ts: evidence retrieval, fiction exclusion.
- source-comparison.ts and research-bridge.ts: retrieval plus source/contrast profiles.
- roleplay-service.ts: allowed paths, fiction-only, semantic-disabled profile.
- llm-wiki.ts neighborhood: direct semantic call and metadata traversal need migration.
- createServer.ts: shared construction and compatibility adapters.
- search.ts: in-memory lexical documents/postings and bounded memory candidates.
- semantic-search.ts: backend access; filter timing differs by entry route.
- vault-catalog.ts and vault-graph.ts: corpus arrays/maps need large-mode replacements.
- retrieve currently bounds fused previews before final evidence hydration; audit lost evidence coverage.
- memoryCandidates caps metadata at10000 and owns a separate semantic timeout/fusion path.
- Installed LanceDB0.38 exposes listIndices/explainPlan/prefilter/bypassVectorIndex; live use unverified.

## Acceptance
Freeze allowed candidate and strict-filter contracts before replacing adapters.
Test public route parity, private underfill, revision races and bounded responses.
Review current code/tests before each edit; this inventory is not live-index inspection.
