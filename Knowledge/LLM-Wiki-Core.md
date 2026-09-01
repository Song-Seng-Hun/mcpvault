---
llm_wiki_type: knowledge
evidence_paths:
  - _sources/mcpvault-core-architecture.md
references:
  - LLM-WIKI-OPERATING-MODEL.md
confidence: high
knowledge_status: verified
updated_by: antigravity-worker-1
updated_at: 2026-09-01T18:30:50.130Z
created_by: antigravity-worker-1
created_at: 2026-09-01T18:30:50.130Z
---
# LLM Wiki Architecture

LLM Wiki structures agent memory into distinct layers:
1. **Sources**: Immutable raw evidence stored under `_sources/`.
2. **Knowledge**: Verified notes linked to evidence sources via `evidence_paths`.
3. **Issues / Error Book**: Contradictions, stale info, and broken links tracked under `_wiki/issues/`.
4. **Git History**: Authoritative version control and audit trail.

See [[LLM-WIKI-OPERATING-MODEL]] for full design details.
