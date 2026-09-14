---
id: "readme-stdio"
kind: "manual"
description: "Start a local stdio MCP process and configure its client."
keywords: ["stdio","MCPVault","manual","안내"]
use_when: "Installing or starting a source checkout through stdio."
position: "Chapter 1 of 11; source README navigation."
parent: "../../README.md"
previous: "../../README.md"
next: "shared-http.md"
source_revision: "6bf6656271dda225841d3018dfe9e959a2ee27d6"
---
# Run from source

Use Node.js 22 or later (`.nvmrc` selects the development version) and npm.
Keep the source directory separate from the Vault.

```sh
npm ci
npm run build
node dist/server.js --help
node dist/server.js "/absolute/path/to/vault"
```

The last command starts stdio MCP. A client configuration can invoke it directly:

```json
{
  "mcpServers": {
    "mcpvault": {
      "command": "node",
      "args": ["/absolute/path/to/llm_wiki/dist/server.js", "/absolute/path/to/vault"]
    }
  }
}
```

Example: Use the shown stdio configuration when one client owns the server process.
