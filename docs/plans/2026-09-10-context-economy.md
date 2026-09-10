# Plan 1: Context economy (approved 2026-09-10)

Status: implementation in progress. Implement and verify this plan before Plan 2.

## Goal and decisions

Preserve authoritative Markdown and original resource bytes while reducing irrelevant and repeated model input. Derived document structures, descriptions, graphs and embeddings are advisory and rebuildable. Search semantic fragments, read exact lines or minimal necessary context, then explicitly expand previous/next/parent context. Do not fragment meaning or silently omit long-document tails.

- Local parsing/OCR/extractive descriptions by default. External document services and LLM enrichment require explicit scope permission and cost caps; never automatically call them.
- Preserve/search/read/export Skill scripts and resources without executing them.
- Default semantic reading includes necessary headings, table headers and list context. Exact one-line reads remain available.
- Keep the five-tool MCP surface and existing APIs; implement shared service endpoints behind call_endpoint and REST adapters.

## Implementation contract

1. Typed resources: Markdown, text/scripts, PDF first. Preserve relative paths, original bytes, hashes, licenses and explicit rejected/unavailable entries. Retain source immutability and scope checks. Block path traversal, junction/symlink escape and embedded commands. Do not weaken the global Markdown PathFilter to admit arbitrary host files.
2. Local PDF worker: Docling native text extraction first; layout/table enrichment for complex pages and RapidOCR ONNX Korean PP-OCRv5 only where needed. Pin dependencies/models, disable remote services, separate model download from document egress. Compare Tesseract kor+eng on the same evaluation fixtures, not duplicate every production conversion. Start one worker/two inference threads, bounded bytes/pages/time/memory. Resume failed pages. Report unavailable dependencies, uncertain reading order and OCR gaps. Keep source hash, profile, page and bounding box; extracted line numbers are not physical PDF line numbers.
3. Structure: remark-parse/GFM plus Obsidian syntax handling, preserving raw source offsets. Heading hierarchy, paragraphs, lists, quotes/callouts, tables, fences, footnotes, wiki/block references. Join undersized siblings; split large blocks along semantic boundaries with parent links. Embedding slices fit the existing model token budget including context, without truncating document coverage at 64 chunks.
4. Fragments: source revision, parser profile, ID, kind, heading path, extractive description, exact source locator, parent/children/previous/next and explicit references. Reading order and semantic similarity are separate. Generated descriptions are optional, versioned, cached and never cited as evidence.
5. CRUD: subscribe to existing catalog changes, reparse changed documents, reuse unchanged embedding inputs by content/context/profile hash. Atomically switch each document generation. Reject stale references; recheck current source and visibility. Delete/rename refresh edges; NAS unavailability is not deletion. Store new derived structures in host-local cache, rebuild from NAS originals, do not migrate all legacy indexes as unrelated work.
6. Endpoints: documents.outline, documents.read, documents.search, resources.manifest, resources.export. Revision-pinned bounded results include precise returned ranges, omissions and actionable continuation. documents.read supports exact/semantic, previous tail N lines, next head N lines, parent and batched ranges. Important missing prerequisites/counterpoints are explicit gaps, not silently discarded.
7. Existing search, question/context packets, evidence and Skill reads share fragment resolution. Preserve existing APIs. Framework-neutral text/metadata/locator/relationship records plus thin LangChain/LlamaIndex adapters; no mandatory RAG framework dependency. Handle Canvas/Bases as their own formats rather than fake Markdown. Caller-provided reading receipts may avoid duplicates, never assume previous context or prevent explicit rereads. Server cannot erase client conversation history.

## Ordered checkpoints

- [ ] Contracts and evaluation baseline.
- [ ] Markdown structure, semantic/exact/neighborhood reads and long-note coverage.
- [ ] Revision/CRUD/cache correctness and search/context integration.
- [ ] Skill bundles, PDF worker, bounded provenance and exports.
- [ ] RAG adapters, progressive client guidance and evaluation.
- [ ] Independent specification and quality reviews; targeted tests, build, full tests, diff check.
- [ ] NAS-backed runtime deploy, rollback artifacts, live verification, generated dist, commit and push to the user fork.

## Acceptance

At least 100 fixed queries covering Korean/English Markdown, native PDF, scanned PDF, multi-column/table/footnote documents and Skill bundles. Include one-line answers, qualifiers/negation, tables, fences, long tails, repeated headings, revision races, rename/delete, NAS outage, hidden neighbors/statistics, malicious PDFs and export byte equality. Rebuild must be deterministic for a fixed revision/profile.

Important qualifier tests all pass; correctness and exact citations do not regress with the same answering model/evaluation. Target >=30% lower median cumulative model input including tool envelopes, all added reads and repeated history. Report total calls, latency, OCR resource use and reindex cost; do not claim a measured saving from shorter individual outputs. Keep the legacy default if the quality/economy gate is unproven or fails. Security/correctness regressions block rollout. Optional PDF dependency absence must not break Markdown functionality.

## Research basis

- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://arxiv.org/abs/2307.03172 (Lost in the Middle; not a universal model claim)
- https://www.anthropic.com/engineering/contextual-retrieval
- https://docling-project.github.io/docling/concepts/chunking/
- https://docling-project.github.io/docling/usage/advanced_options/
- https://docling-project.github.io/docling/concepts/OCR/
- https://arxiv.org/abs/2403.14403 (Adaptive-RAG)
- Late Chunking, RAPTOR and LLMLingua-2 remain optional ablations, not default lossy compression or mandatory model changes.
