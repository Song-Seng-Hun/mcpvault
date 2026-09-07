# Shared HTTP runtime and one-time endpoint catalog

Design approval is delegated. Inspect only repository code and disposable test
servers, never reconfigure the installed plugin or terminate existing servers.

## Findings and boundaries

Each top-level createServer allocates its own catalog, metadata/graph/lexical
indexes and semantic service. The embedder pool is process-local and lazy;
constructing services does not prove native models are loaded. HTTP's request
server factory closes over these existing services, not createServer. Verify
this through two real SDK clients and constructor witnesses that invoke the
real implementations. Separate top-level runtimes should produce separate
owners; multiple HTTP requests on one runtime must not.

tools/list currently rebuilds all dynamic tool schemas and clears/refills the
endpoint registry although the build has static definitions and per-call
authorization. REST adapter setup also calls an unconditional rebuild helper.
This is redundant allocation and makes the schema vary before/after first list
(optional accessToken is added only in the list handler).

Normalize the complete catalog at construction once, then make the existing
ensureEndpointRegistry helper idempotent and tools/list return the fixed five
descriptors without rebuilding. Add accessToken to non-auth tools at the shared
preparation point with shallow schema/property copies, not shared constant
mutation. Do not cache available/locked states or caller identity: registry
search and execution continue evaluating the supplied principal each call.

Alternatives: auto-attach shared daemon could eliminate separate stdio runtime
owners, but needs stronger process/endpoint identity and lifecycle design;
global cross-runtime caches risk vault/policy bleed. Neither is silently added
here. This increment establishes an executable sharing contract and removes a
confirmed recurring allocation while keeping the deployment boundary explicit.

## Evidence required

Two real HTTP clients list the same five tools; repeated/concurrent lists plus
ensure do not call registry.setTools after construction, and descriptor identity
and auth schema are stable before/after list. Count real catalog/index/semantic
constructors: one bundle for one runtime despite multiple request servers, two
bundles for two top-level runtimes. Close one HTTP client and prove the other
still functions. Authenticate two fixture accounts and an anonymous call to
prove identities do not stick to the shared runtime. No model download or GPU
inference is needed; do not claim process RSS/model-load savings from owner counts.

Run focused HTTP/server/auth tests, build, independent read-only review, full
single-worker suite and diff check. Explicit staging of source/dist/docs/tests;
publish only the user's fork main and verify remote SHA. Leave Goal active.
