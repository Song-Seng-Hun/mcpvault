---
id: reviewed-short-lease
kind: implementation-note
description: Optional short expiry for reviewed-skill host authorization.
keywords: [reviewed skills, canary, expiry, authorization, 시험]
use_when: Preparing a separately authorized, time-bounded read inspection.
position: Follow-up to reviewed procedure transport; not skill admission.
parent: 2026-09-16-reviewed-procedure-transport.md
previous: 2026-09-16-reviewed-procedure-transport.md
next: 2026-09-16-reviewed-skill-progress-contract.md
---
# Short inspection authorization

Host configuration may specify `expiresAt` as canonical UTC ISO text.
At loading, remaining lifetime must be positive and at most 15 minutes.
Example value shape: `YYYY-MM-DDTHH:mm:ss.sssZ`; use a real future deadline.
The fixed deadline is not renewed by policy refresh or configuration reload.
Existing configurations without this field keep their previous behavior.

Current authority checks enforce both absolute and monotonic deadlines.
Observed expiry permanently invalidates the held authorization object.
Loading the same configuration after its absolute expiry fails.
Expiry during loading also fails before the bridge is returned.

This field restricts existing consent; it cannot create an account, binding,
grant, approved release, or permission to install or execute a skill.
It is host configuration, never an MCP argument or a skill declaration.
No real host configuration or admission was created by this implementation.

## Boundaries

This is not a single-use grant: reload before expiry can still succeed.
It does not stop a listener socket, erase stored bytes, or isolate OS processes.
Trusted host storage APIs remain internal; public delivery requires current
account, source, consent and release checks, including the expiry fence.
Clock rollback within a running process does not extend its monotonic lifetime.
Cross-process clock tampering is not solved by this change.
Previously rejected persistent access mutations remain rejected; this option
does not authorize retrying them or using an equivalent alternate path.

## Verification boundary

Three new cases cover expiry/reload, malformed or excessive lifetime, and
wall-clock rollback. Existing authenticated MCP and binding tests remain.
Synthetic checks and deployed inactive code are not live skill activation.

Delivery: build passed; 525 regression files, 7,080 tests passed, 4 skipped.
Inactive build deployed; public read and anonymous denial baseline unchanged.
No actual skill activation or host-access grant was performed.
