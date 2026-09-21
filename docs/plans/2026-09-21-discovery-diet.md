---
id: discovery-diet-delivery
kind: implementation-record
description: Bounded tool discovery, obsolete-helper removal and leaner architecture/policy tests.
keywords: [diet, MCP, UTF-8, descriptor, regression, 다이어트]
use_when: Checking this bundle's reductions, compatibility or release evidence.
position: Discovery bundle; global output ceiling remains incomplete.
parent: 2026-09-21-diet.md
previous: 2026-09-21-diet-output-boundary.md
next: ../agent-rules/validation.md
---
# Discovery and validation diet

Base: main 37f89556cd4a51b21d294583b72d3f8181e79ac4.
Keep five MCP tools, public endpoint IDs, current ACL and source protection.
tools/list pages preserve schemas within 5,000 UTF-8 bytes of result JSON.
Oversized translated prose uses the same code-owned tool definition.
Exact endpoint#JSON-Pointer reads page descriptors and long literal strings.
Cursors bind current descriptor, registration and authority; stale reads restart.
Unicode roundtrip preserves paired and lone surrogate units; pages must advance.
General tool-call/REST output is NOT yet globally byte-bounded.

## Removals and preserved behavior

- Remove unused expression-names helper and its two exclusive tests; retain bilingual policy.
- Remove unused storyReadAlias; operationReadAlias remains the live read-only route.
- Reuse search prefix selection for metadata lists; preserve both API names.
- Remove copied UML hash/test-link manifest; read fixed current source directly.
- Keep AST fields/states/imports, required actual test declarations and unsafe-path checks.
- Comments no longer require manual hash recertification. Test/build source receipts remain.
- Policy tests instantiate a server only for registry routing; consolidate mutation checks.
- Refresh generated guidance with --write-catalog, without instrumenting unrelated source.

## Accounting and validation

Handwritten production/tests/scripts: +379/-160 = NET +219 lines in this bundle.
This includes new bounded discovery; do not report it as net-negative dieting.
Generated catalog/dist and documentation are separate; line wrapping is not savings.
Connection instructions: 2,446 -> 2,061 UTF-8 bytes (-15.74%); tokens unmeasured.
Policy contract: seven tests retained and passed; server initialization is localized.
Targets: eight files, 111 passed; build exit 0 in 3.31s.
Full: 567 files, 7,464 passed / 7,468 total; four existing skips; native exit 0.
Elapsed 2,816.92s. Invalid resume flags failed before tests; preserve that separate log.
Frozen basis: c9bfe43450de83c48bbd1a3b21d417e365c9339433086352c2d25f11bc64a04a.
NAS release activated; retain previous runtime and rollback launcher. Canonical bytes unchanged.
Live: five tools, catalog 4,579 bytes; five descriptor pages, maximum 509 bytes; exact leaf read.
Existing authenticated discovery, catalog, graph and continuation checks passed; no body writes/bindings.
Organization manifest still returned 13,853 characters: global 5KB compliance is explicitly incomplete.
Remaining: global 5KB behavior, broader consolidation and measured end-to-end cost reduction.
