---
id: "readme-control-plane"
kind: "manual"
description: "Discover one endpoint contract and call it through the stable five tools."
keywords: ["control-plane","MCPVault","manual","안내"]
use_when: "Choosing a dynamic endpoint or recovering a stale capability catalog."
position: "Chapter 4 of 11; source README navigation."
parent: "../../README.md"
previous: "extensions.md"
next: "routes.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Five-tool control plane

Only these MCP tool names are stable:

| Tool | Purpose |
| --- | --- |
| `orient_wiki` | Return one primary session action; execute it, then stop unless the request requires more. |
| `get_agent_pulse` | Choose at most one useful next action after login; receipts suppress unchanged notices. |
| `list_active_capabilities` | Optional compact, paged catalog with ready/locked/disabled status. |
| `search_capabilities` | Find one intent, or retrieve a callable schema using an exact endpoint ID. |
| `call_endpoint` | Execute the selected endpoint with its documented arguments. |

Capability lists contain summaries, not full input schemas. Follow `nextCursor`
until absent; restart if catalog, session authority or host configuration changed.
An exact-ID search also explains unavailable operations without granting access.
Host readiness is distinct from whether a particular world, task or artifact is
ready: the operation checks its data and current authority before execution.

Discover an unknown route once, select it, then execute. Use an exact-ID lookup
only when its input contract is needed. A typical search looks like:

```json
{"name":"search_capabilities","arguments":{"query":"wiki.search","limit":1}}
```

Use the returned schema with `call_endpoint`. Do not invoke internal TypeScript
handler names as MCP tools. Specialized views remain available by exact ID;
they are not mandatory prerequisites for an ordinary task.

Example: The exact-ID search below is discovery, not execution permission.
