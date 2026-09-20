---
id: memory-retention
kind: interface-manual
description: Confirmed-context-only omission without time-based forgetting.
keywords: [receipt, context, reuse, compaction, 망각, 중복]
use_when: Integrating a host that can attest retained context.
position: Retention chapter after grounding; verification follows.
parent: 2026-09-20-memory-flow.md
previous: 2026-09-20-memory-grounding.md
next: 2026-09-20-memory-completion-evidence.md
---
# Retention is not delivery

Default memory reads remain full. Delivery can issue an opaque process-local
receipt; it never proves that the agent received or retained those bytes.
The server host API can confirm a receipt against an authenticated principal
and current context generation. This is not an MCP/REST authorization endpoint.
Unsupported hosts do not suppress evidence automatically.

Example: `reuse:{mode:"if_retained",knownReads:["<deliveryReceipt>"]}`.
Only a matching host-confirmed basis omits unchanged excerpts. Item revisions,
warnings and exact source-read actions remain. Omission must reduce total bytes.
`reuse:{mode:"full"}` always rereads without another confirmation question.
No time cooldown denies a document read.

Scope, policy, revision, new related evidence, session or context-generation
changes disable reuse. Hosts call `invalidateMemoryRetention` on compaction.
Restart/eviction loses acknowledgements and safely returns current content.
At most 256 receipt records are held; no bodies are stored in this cache.
No unsupported delta chain or implicit context-retention claim is introduced.

## Roles and forgetting

Working context uses continuity; episodes preserve circumstances and outcomes.
Semantic/procedural memories are scoped interpretations, not automatic truth.
Archive/expiry/correction changes current presentation, never source deletion.
Self-contained tasks skip optional memory; mandatory rules remain unchanged.
Rare conditions/counterexamples are not erased by popularity or age.
Test memory benefit and harmful irrelevant injection separately.
Returned characters, retrieval time and actual model tokens are different metrics.
