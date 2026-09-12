#!/usr/bin/env node

import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer, getServerRuntime } from "./src/createServer.js";
import { loadHostFeatureConfig } from './src/host-feature-config.js';
import { loadOwnerActivityHostConfig } from './src/owner-activity-host.js';
import { loadMaintenanceHostConfig } from './src/maintenance-host.js';
import { loadCompilationHostConfig } from './src/compilation-host.js';
import { createServerLifecycle } from "./src/server-lifecycle.js";
import { parseCliArgs } from "./src/cli.js";
import { startRestApi } from "./src/rest-api.js";
import { startMcpHttpApi } from "./src/mcp-http.js";
import { loadEconomyHostConfig, probeEconomyStorage } from './src/economy-host.js';
import { EconomyLedger } from './src/economy-ledger.js';
import { RoleplayStore } from './src/roleplay-store.js';
import { loadRoleplayHostConfig } from './src/roleplay-host.js';
import { loadSkillEvolutionHostConfig } from './src/skill-evolution-host.js';
import { loadExplanationHostConfig } from './src/explanation-host.js';
import { loadBenchmarkHostConfig } from './src/benchmark-host.js';
import type { BenchmarkService } from './src/benchmark-service.js';
import { acquireBenchmarkWriter, type BenchmarkWriter } from './src/benchmark-runtime.js';
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
  --economy-config FILE
                  Optional host-private approved economy policy, default OFF.
                  Run economy-host doctor/initialize first; never mints on start.
  --roleplay-config FILE
                  Opt-in shared fictional world with host-approved administrators.
                  Trusted checkpoint outside Vault/source; existing rooms unchanged.
  --skill-evolution-config FILE
                  Opt-in experience and candidate recording with a private host key.
                  No automatic evaluation without host-registered skill profiles.
  --explanation-config FILE
                  Explicit source collection and host-verified reviewer profiles.
                  Pull-only Gemini explanation preference; never calls a model.
  --benchmark-config FILE
                  Opt-in private host-approved challenges. Does not open a contest,
                  create an account, approve rewards or change the supply cap.
  --features-config FILE
                  Explicit owner-private v1 feature selection, applied at startup.
                  Default: wiki-core only. Does not grant data/provider/owner consent.
                  Environment alternative: MCPVAULT_FEATURE_CONFIG.
  --owner-activity-config FILE
                  Separate private human-owner consent; grants no document access.
                  Legacy bridges still need an independently verified execution
                  controller. A file or localhost label is not that proof.
                  Environment alternative: MCPVAULT_OWNER_ACTIVITY_CONFIG.
  --mcp-http[=PORT]
                  Expose MCP 2026 Stateless Streamable HTTP (default 8788)
  --mcp-http-only[=PORT]
                  Dedicated shared HTTP process; no stdio transport (default 8788)
                  Connect clients to the same /mcp URL; keep this process running
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
const { vaultPathArg, readOnly, restPort, mcpHttpPort, mcpHttpHost, mcpHttpTlsCert, mcpHttpTlsKey, stdio, economyConfig, roleplayConfig, skillEvolutionConfig, explanationConfig, benchmarkConfig, featuresConfig, ownerActivityConfig, maintenanceConfig, compilationConfig } = parseCliArgs(cliArgs);
const vaultPath = resolve(vaultPathArg || process.cwd());
const featurePath = featuresConfig ?? process.env.MCPVAULT_FEATURE_CONFIG;
const ownerConsentPath = ownerActivityConfig ?? process.env.MCPVAULT_OWNER_ACTIVITY_CONFIG;
const features = await loadHostFeatureConfig(featurePath ? resolve(featurePath) : undefined, vaultPath);

if (mcpHttpPort === undefined && (mcpHttpHost || mcpHttpTlsCert || mcpHttpTlsKey)) {
  throw new Error('--mcp-http-host, --mcp-http-cert, and --mcp-http-key require --mcp-http');
}

const hostEconomy=features.selected.includes('economy')&&economyConfig?await loadEconomyHostConfig(resolve(economyConfig),vaultPath):undefined;
const hostBenchmark = features.selected.includes('benchmarks') && benchmarkConfig ? await loadBenchmarkHostConfig(resolve(benchmarkConfig), vaultPath) : undefined;
let benchmarkAuthority: BenchmarkService | undefined;
let economy:NonNullable<Parameters<typeof createServer>[1]>['economy'];
if(hostEconomy?.policy.enabled) {
  for(const path of [hostEconomy.ledgerPath ?? hostEconomy.vaultPath,hostEconomy.hostPath])await probeEconomyStorage(path);
  economy={policy:hostEconomy.policy,ledger:await EconomyLedger.open({...hostEconomy,storageVerified:true,
    ...(hostBenchmark?.enabled && { benchmarkAuthority: {
      assertHumanOperator: hostBenchmark.assertHumanOperator,
      validateAward: async (proof, state) => {
        if (!benchmarkAuthority) throw Error('Current benchmark adjudication service unavailable');
        await benchmarkAuthority.validateAwardProof(proof, state);
      },
    } }),
  })};
}
let mcpServer:ReturnType<typeof createServer>;
let roleplay: RoleplayStore | undefined;
let benchmarkWriter: BenchmarkWriter | undefined;
try {
  if (hostBenchmark?.enabled && !readOnly) benchmarkWriter = await acquireBenchmarkWriter(hostBenchmark);
  const maintenance = maintenanceConfig && !readOnly ? await loadMaintenanceHostConfig(resolve(maintenanceConfig), vaultPath) : undefined;
  const compilationHost = compilationConfig ? await loadCompilationHostConfig(resolve(compilationConfig), vaultPath) : undefined;
  const skillEvolution = features.selected.includes('skill-evolution') && skillEvolutionConfig ? await loadSkillEvolutionHostConfig(resolve(skillEvolutionConfig), vaultPath) : undefined;
  const explanations = features.selected.includes('explanation-translation') && explanationConfig ? await loadExplanationHostConfig(resolve(explanationConfig), vaultPath) : undefined;
  if (features.selected.includes('roleplay') && roleplayConfig) roleplay = await RoleplayStore.open(await loadRoleplayHostConfig(resolve(roleplayConfig), vaultPath));
  mcpServer=createServer(vaultPath, { version: VERSION, readOnly, features, ...(economy&&{economy}), ...(roleplay && { roleplay }), ...(skillEvolution && { skillEvolution }),
    ...(maintenance && { maintenance }),
    // A configuration file is not execution attestation. CLI admission stays
    // waiting without a real host verifier and validated application adapter.
    ...(compilationHost && { compilation: { host: compilationHost } }),
    // A legacy bridge cannot verify the execution behind a client. A policy
    // file alone must not turn labels or localhost into runtime attestation.
    ...(ownerConsentPath && { ownerActivity: { ...await loadOwnerActivityHostConfig(resolve(ownerConsentPath), vaultPath), execution: () => undefined } }),
    ...(hostBenchmark?.enabled && { benchmarks: {
      enabled: true, definitions: hostBenchmark.definitions,
      accountProfiles: async () => { await benchmarkWriter?.assertHeld(); return hostBenchmark.accountProfiles(); },
      answerReader: hostBenchmark.answerReader, integrity: hostBenchmark.integrity,
      assertHumanOperator: async actor => { await benchmarkWriter?.assertHeld(); await hostBenchmark.assertHumanOperator(actor); },
      bindAuthority: (service: BenchmarkService) => { benchmarkAuthority = service; },
    } }),
    ...(explanations?.enabled && { explanations: { sources: explanations.sources }, workCollaboration: { executionProfiles: explanations.executionProfiles } }) });
} catch(error){try { await roleplay?.close(); } finally { try { await economy?.ledger.close(); } finally { await benchmarkWriter?.close(); } } throw error;}
const lifecycle = createServerLifecycle(mcpServer);
if (benchmarkWriter) lifecycle.add(benchmarkWriter);
if(economy)lifecycle.add(economy.ledger);
if (roleplay) lifecycle.add(roleplay);
const ownsNetwork = mcpHttpPort !== undefined || restPort !== undefined;
let isShuttingDown = false;

try {
  // Each protocol owns only its wrapper. The CLI alone owns shared services,
  // including when stdio never receives an opening handshake.
  if (stdio !== false) {
    const transport = new StdioServerTransport();
    const closeTransport = transport.close.bind(transport);
    transport.close = async () => {
      await closeTransport();
      // Fatal wire errors can pause stdin without emitting EOF. Observe the
      // wire, not a probe/product disposal during protocol negotiation.
      if (!ownsNetwork) void shutdown();
    };
    lifecycle.add(serveStdio(
      () => getServerRuntime(mcpServer)!.createRequestServer(),
      { transport, onerror: (error) => console.error(error) },
    ));
  }

  if (restPort !== undefined) {
    const restHandle = await startRestApi(mcpServer, { port: restPort });
    lifecycle.add(restHandle);
    console.error(`MCPVault REST adapter listening on http://${restHandle.host}:${restHandle.port}`);
  }

  if (mcpHttpPort !== undefined) {
    const configuredHost = mcpHttpHost || process.env.MCPVAULT_MCP_HTTP_HOST;
    const configuredTlsCert = mcpHttpTlsCert || process.env.MCPVAULT_MCP_HTTP_TLS_CERT;
    const configuredTlsKey = mcpHttpTlsKey || process.env.MCPVAULT_MCP_HTTP_TLS_KEY;
    if (Boolean(configuredTlsCert) !== Boolean(configuredTlsKey)) {
      throw new Error('MCP HTTP TLS requires both a certificate and a private key');
    }
    const configuredHosts = String(process.env.MCPVAULT_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
    const configuredOrigins = String(process.env.MCPVAULT_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const mcpHttpHandle = await startMcpHttpApi(mcpServer, {
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
    lifecycle.add(mcpHttpHandle);
    console.error(`MCPVault Stateless MCP HTTP listening on ${mcpHttpHandle.protocol}://${mcpHttpHandle.host}:${mcpHttpHandle.port}${mcpHttpHandle.path}`);
  }
} catch (error) {
  console.error('MCPVault startup failed:', error);
  for (const closeError of await lifecycle.close()) console.error('MCPVault cleanup failed:', closeError);
  process.exit(1);
}

// Exit when the client disconnects (stdin EOF) or the process is asked to
// terminate. Hosts that don't send an MCP shutdown request otherwise leave
// this process running forever, orphaned once stdin closes (#159).
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  const errors = await lifecycle.close();
  for (const error of errors) console.error('MCPVault cleanup failed:', error);
  process.exit(errors.length ? 1 : 0);
}

if (!ownsNetwork) {
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
