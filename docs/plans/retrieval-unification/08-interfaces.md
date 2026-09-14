---
id: retrieval-interfaces
kind: implementation-plan
description: Dynamic API extensions and compatibility guards.
keywords: [MCP, REST, capabilities, API, 계약]
parent: README.md
previous: 07-feedback-graph.md
next: 09-evaluation.md
---
# Interfaces
Use: adapter migration and operation authorization. Not: new fixed MCP tools.
Keep the fixed five-tool control plane.
Existing search, question and related APIs use shared plans without changing default meaning.
Preserve existing argument names, enums, errors and default response shapes.
wiki.context_route returns short cards, basis, requiredReads, gaps and continuation.
wiki.context_session attaches state/exposure basis to prepare/read/update/check/finish.
Delegate actual task/continuity writes to existing owners.
documents.read adds optional full/if_changed/delta and base receipt; old calls default full.
Preserve existing mode=semantic|exact; add a separate deliveryMode instead of reusing mode.
Reuse signed knownReads/forceRead ranges; a range receipt alone does not prove retained context.
wiki.search_feedback adds optional result receipt, revision and reason.
Keep legacy query feedback compatible; it is not sufficient for per-result penalties.
wiki.search_improvements and exception board expose scoped review/repair/invalidation status.
New mutating operations require capability, read-only rejection, request ID and revision checks.
Validate current authorization both before work and at returned evidence.
Cache bookkeeping grants no Vault write authority.
Bind basis to policy/catalog/document revisions and index generations.
Keep exact source read/export behavior and source-only restrictions.
Return partial for unperformed checks, not successful verification.
Do not expose backend internals or hidden candidate counts through compatibility errors.

## Acceptance
Same conditions across MCP/REST, general/situation/memory/source comparison.
Fact/fiction separation, private memory and legacy ordering remain explicit profiles.
Operation-level read-only tests cover mixed read/write endpoints.
Architecture guard tests fail deliberate direct-backend and duplicate-fusion bypasses.
