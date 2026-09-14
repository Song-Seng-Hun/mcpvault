---
id: repository-agent-code
kind: project-rule
description: Service ownership, path safety, mutation guards and regression/staging gates.
keywords: [TypeScript, PathFilter, tests, revision, dist, 코드]
use_when: Before editing repository code and before committing its tested build.
position: Chapter 9 of 9; code checks close the repository workflow.
parent: ../../AGENTS.md
previous: deployment.md
next: ../../AGENTS.md
source_revision: 6bf6656271dda225841d3018dfe9e959a2ee27d6
---
# Architecture and code changes

Architecture boundaries:

- `src/createServer.ts` owns the fixed five-tool control plane and adapters.
- `src/endpoint-registry.ts` maps internal operations to dynamic endpoint IDs.
- service modules own business logic shared by MCP/REST adapters, never duplicated.
- `src/filesystem.ts`, `src/pathfilter.ts`, and `src/scope-access.ts` enforce
  path, source immutability, and visibility rules.
- catalog/metadata/search/semantic/graph/notification/reputation indexes are
  disposable Markdown read models.
- `src/llm-wiki.ts` and `src/organization.ts` own knowledge workflows and
  organization contracts.

For every code change:

1. Inspect implementation and nearby tests before editing.
2. Keep every path input behind normalization, `PathFilter`, and the caller's
   access predicate. Aggregates and ambiguity details must not leak hidden candidates.
3. Cover success, failure, concurrency/revision, bounded output and security
   in proportion to risk. Markdown parsing ignores examples inside matching
   backtick or tilde fences.
4. Add every mutating operation to the read-only rejection set and endpoint
   capability model.
5. Run targeted tests, `npm run build`, the full `npm test`, and `git diff --check`.
6. `dist/` is committed: include generated output in the same commit as its source.
   Do not commit `.agents/`, `.mcpvault/`, credentials, or caches.
   After staging, run `npm run check:staged` (paths only); review staged content
   for secrets. Never auto-unstage/delete user data.

Keep MCP small, responses bounded, writes revision-safe, Markdown/Git authoritative
and guidance progressive.
Example: a new mutation needs both a read-only denial test and a revision-race test.
