---
id: http-read-diet
kind: implementation-record
description: Shared HTTP guards and exact progressive JSON reads without mutation replay.
keywords: [diet, HTTP, REST, JSON Pointer, context, 출력]
use_when: Reviewing transport consolidation or bounded read views.
position: Follow-up to discovery diet; global output migration remains open.
previous: 2026-09-21-discovery-diet.md
next: 2026-09-21-diet-output-boundary.md
---
# HTTP and read diet

Base: `755e4374f` on existing main; retain the interrupted transport consolidation.
Preserve API operations, auth, original bytes, revision checks and user edits.

## Consolidation

- MCP/REST share request-body limits, host/origin parsing and listener limits.
- Each listener keeps separate registration/login rate buckets and counters.
- LAN, mTLS, reviewed-skill admission, CORS and REST ETags stay transport-owned.
- Chat reuses existing social text, identity, ownership and window helpers.
- Descriptor and response views share the same pure JSON pager.
- No new cache, approval system, execution engine or mutable singleton.

## Progressive reads

- `call_endpoint.responseView`: JSON Pointer into the current authorized result.
- `responseCursor`: next page; retain the original endpoint and arguments.
- REST equivalents: query `$view` and `$cursor`; not endpoint-body arguments.
- Example: `wiki.organization_manifest`, `responseView=/contracts/noteKinds`.
- Large MCP organization manifests start with a bounded root view automatically.
- REST/internal calls retain their JSON shape unless an explicit view is requested.
- Each view's full serialized MCP text envelope is at most 5,000 UTF-8 bytes.
- An object entry without `value` needs its child `path`; `partial` stays explicit.
- Exact Unicode fragments preserve originals; cursors bind result, path, request and authority.
- Every continuation reruns the authorized read. No stale private response cache.
- Changed/volatile results invalidate continuation; restart or use a stable read.
- Mutation selectors are rejected before execution. Never replay writes to page receipts.
- Authentication responses do not support response views.
- Missing/inaccessible paths return no hidden source content or suggestions.

## Evidence and remaining scope

Build/full regression passed; NAS deployment and public MCP reads verified.
Global 5KB output coverage is NOT complete; other legacy reads/mutations remain.
Descriptor tests retain exact schema recovery; test consolidation is reported separately.
Large-string pager probe: 20 reads, 1097.50ms before / 222.99ms after (local, one run).
The pager bounds candidate fragments before serialization; source/hash checks stay intact.
This measures pager CPU time, not NAS latency, model tokens or Antigravity behavior.
Live manifest first response: 16602->3370 bytes (partial); selected note kinds: 419 bytes.
