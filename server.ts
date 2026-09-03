#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./src/createServer.js";
import { parseCliArgs } from "./src/cli.js";
import { startRestApi } from "./src/rest-api.js";
import { startMcpHttpApi } from "./src/mcp-http.js";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// `npm start` runs this file from the repository root through tsx, while a
// packaged build runs `dist/server.js`. Resolve both layouts so the local
// Codex plugin can start the same server without a tunnel.
const packagePath = [join(__dirname, "package.json"), join(__dirname, "../package.json")]
  .find((candidate) => existsSync(candidate));
if (!packagePath) {
  throw new Error(`Unable to locate package.json from ${__dirname}`);
}
const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
const VERSION = packageJson.version;

// Handle --version and --help flags
const cliArgs = process.argv.slice(2);
const firstArg = cliArgs[0];

if (firstArg === "--version" || firstArg === "-v") {
  console.log(VERSION);
  process.exit(0);
}

if (firstArg === "--help" || firstArg === "-h") {
  console.log(`
mcpvault v${VERSION}

Universal AI bridge for Obsidian vaults - connect any MCP-compatible assistant

Usage:
  npx @bitbonsai/mcpvault [vault-path] [--read-only[=true|false]]

Arguments:
  [vault-path]    Optional path to your Obsidian vault directory
                  Defaults to current working directory when omitted

Options:
  --version, -v   Show version number
  --help, -h      Show this help message
  --read-only     Expose read tools only and reject all vault mutations
                  May be passed alone, with true/false, or as --read-only=true
  --http[=PORT]   Also expose the optional localhost REST adapter (default 8787)
  --mcp-http[=PORT]
                  Expose MCP 2026 Stateless Streamable HTTP (default 8788)
                  Optional LAN/TLS flags: --mcp-http-host HOST,
                  --mcp-http-cert FILE, --mcp-http-key FILE
                  Optional env: MCPVAULT_MCP_HTTP_HOST,
                  MCPVAULT_MCP_HTTP_TLS_CERT, MCPVAULT_MCP_HTTP_TLS_KEY,
                  MCPVAULT_ALLOWED_HOSTS, MCPVAULT_ALLOWED_ORIGINS

Examples:
  npx @bitbonsai/mcpvault
  npx @bitbonsai/mcpvault ~/Documents/MyVault
  npx @bitbonsai/mcpvault ./Vault
  npx @bitbonsai/mcpvault ./Vault --read-only
  npx @bitbonsai/mcpvault /path/to/obsidian/vault
  npx @bitbonsai/mcpvault "/path/with spaces/Obsidian Vault"
`);
  process.exit(0);
}

// Remove runtime options before joining trailing args, preserving support for
// unquoted vault paths with spaces. When omitted, use the current directory.
const { vaultPathArg, readOnly, restPort, mcpHttpPort, mcpHttpHost, mcpHttpTlsCert, mcpHttpTlsKey } = parseCliArgs(cliArgs);
const vaultPath = resolve(vaultPathArg || process.cwd());

if (mcpHttpPort === undefined && (mcpHttpHost || mcpHttpTlsCert || mcpHttpTlsKey)) {
  throw new Error('--mcp-http-host, --mcp-http-cert, and --mcp-http-key require --mcp-http');
}

const mcpServer = createServer(vaultPath, { version: VERSION, readOnly });

// Serve both the legacy handshake-based protocol and MCP 2026-07-28 from the
// same process. The opening exchange selects the era for this connection.
const serverHandle = serveStdio(
  () => mcpServer,
  { onerror: (error) => console.error(error) },
);

let restHandle: Awaited<ReturnType<typeof startRestApi>> | undefined;
if (restPort !== undefined) {
  restHandle = await startRestApi(mcpServer, { port: restPort });
  console.error(`MCPVault REST adapter listening on http://${restHandle.host}:${restHandle.port}`);
}

let mcpHttpHandle: Awaited<ReturnType<typeof startMcpHttpApi>> | undefined;
if (mcpHttpPort !== undefined) {
  const configuredHost = mcpHttpHost || process.env.MCPVAULT_MCP_HTTP_HOST;
  const configuredTlsCert = mcpHttpTlsCert || process.env.MCPVAULT_MCP_HTTP_TLS_CERT;
  const configuredTlsKey = mcpHttpTlsKey || process.env.MCPVAULT_MCP_HTTP_TLS_KEY;
  if (Boolean(configuredTlsCert) !== Boolean(configuredTlsKey)) {
    throw new Error('MCP HTTP TLS requires both a certificate and a private key');
  }
  const configuredHosts = String(process.env.MCPVAULT_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
  const configuredOrigins = String(process.env.MCPVAULT_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  mcpHttpHandle = await startMcpHttpApi(mcpServer, {
    port: mcpHttpPort,
    ...(configuredHost && { host: configuredHost }),
    ...(configuredHosts.length > 0 && { allowedHosts: configuredHosts }),
    ...(configuredOrigins.length > 0 && { allowedOrigins: configuredOrigins }),
    ...(configuredTlsCert && configuredTlsKey && {
      tls: {
        cert: readFileSync(configuredTlsCert),
        key: readFileSync(configuredTlsKey),
      },
    }),
  });
  console.error(`MCPVault Stateless MCP HTTP listening on ${mcpHttpHandle.protocol}://${mcpHttpHandle.host}:${mcpHttpHandle.port}${mcpHttpHandle.path}`);
}

// Exit when the client disconnects (stdin EOF) or the process is asked to
// terminate. Hosts that don't send an MCP shutdown request otherwise leave
// this process running forever, orphaned once stdin closes (#159).
let isShuttingDown = false;
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
    await mcpHttpHandle?.close();
    await restHandle?.close();
    await serverHandle.close();
  } catch {
    // Best-effort: exit regardless of transport close errors.
  }
  process.exit(0);
}

if (mcpHttpPort === undefined && restPort === undefined) {
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
