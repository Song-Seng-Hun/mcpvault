---
id: diet-output-boundary
kind: implementation-record
description: Separate the MCP response boundary without losing schemas, receipts or exact reads.
keywords: [MCP, UTF-8, 5KB, pagination, response budget, 출력]
use_when: Refactoring response projection or implementing the transport byte ceiling.
position: Diet companion; transport work remains incomplete.
parent: 2026-09-21-diet.md
previous: 2026-09-21-runtime-diet.md
next: ../agent-rules/validation.md
---
# Response boundary (응답 경계)

Baseline: main 2e7a378ac. Preserve runtime behavior and request contracts.
Move the three response-budget functions from createServer to mcp-response-budget.
Move note/navigation output projections to mcp-note-response.
Reuse one bounded-prefix search in four projections; preserve full-page-first and surrogate checks.
Keep endpoint IDs, maxChars validation, overflow projections and executable arguments exact.
Moves reduce the god file, not total code. Count prefix-loop consolidation separately.

## Remaining byte-ceiling work

- Current budgets measure JavaScript characters, not UTF-8 bytes.
- MCP tool calls, tools/list, server instructions and direct REST responses differ.
- Static five-tool catalog: 4,645 UTF-8 bytes; this excludes editable guidance and transport framing.
- Capability lookup can request 20,000 characters; schema overflow needs progressive reads.
- Registry schema fallback currently says to increase maxChars; a hard ceiling needs schema-page navigation instead.
- A global 5,000-character clamp is not a 5,000-byte guarantee for Korean or emoji.
- Do not cut serialized JSON, executable paths, revisions, conditions or next-action arguments.
- Keep exact read/export compatible; provide bounded continuations for LLM-facing projections.
- Preserve security metadata and distinguish omitted content from complete evidence.
- TOON/TSV may compress presentation tables; required API/schema JSON remains JSON.
- Count the serialized response envelope, not only the first text block.
- Test ASCII, Korean, emoji, escaping, multiple blocks and minimum-budget continuations.

No 5KB compliance, token savings or transport-completion claim is made for this extraction.
