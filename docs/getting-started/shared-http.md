---
id: "readme-shared-http"
kind: "manual"
description: "Share one server process; keep remote transport and optional website boundaries."
keywords: ["shared-http","MCPVault","manual","안내"]
use_when: "Configuring HTTP, TLS or the optional website."
position: "Chapter 2 of 11; source README navigation."
parent: "../../README.md"
previous: "stdio.md"
next: "extensions.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Shared HTTP and website

For a shared process, start dedicated Streamable HTTP and connect clients to
`http://127.0.0.1:8788/mcp`:

```sh
node dist/server.js "/absolute/path/to/vault" --mcp-http-only=8788
```

`--mcp-http=8788` adds HTTP while retaining stdio. `--http=8787` adds the optional
REST adapter. Both reuse the same services and authorization as MCP; agents use
`call_endpoint`, not REST URLs. `--read-only` rejects mutations; mixed-operation
capabilities retain their read operations and explain disabled writes.
HTTP-only mode does not depend on stdin staying open.

Use `--mcp-http-host`, `--mcp-http-cert`, and `--mcp-http-key` for an explicitly
configured LAN/TLS listener. Do not expose an unauthenticated transport to an
untrusted network. Review [client compatibility](../../docs/CLIENT-COMPATIBILITY.md)
and [enterprise network boundaries](../../docs/enterprise-network.md) before remote
deployment. A client showing a plugin is not proof of an actual MCP connection.

The companion website uses Bun: `npm run website` starts `website-shibumi`.
It is not required for MCP or Obsidian.

Example: Use the shared MCP listener for clients that share one server.
