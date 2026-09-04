import { afterEach, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const builtServer = join(repoRoot, "dist", "server.js");
const vaults: string[] = [];

afterEach(async () => {
  await Promise.all(vaults.splice(0).map((vault) => rm(vault, { recursive: true, force: true })));
});

async function connect(mode: "legacy" | "modern") {
  const vault = await mkdtemp(join(tmpdir(), `mcpvault-${mode}-`));
  vaults.push(vault);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [builtServer, vault],
    cwd: repoRoot,
    stderr: "pipe",
  });
  const client = mode === "modern"
    ? new Client(
        { name: "mcpvault-protocol-test", version: "1.0.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      )
    : new Client({ name: "mcpvault-protocol-test", version: "1.0.0" });

  await client.connect(transport);
  return client;
}

test("serves legacy handshake-based MCP clients", async () => {
  const client = await connect("legacy");
  try {
    const result = await client.listTools();
    expect(client.getProtocolEra()).toBe("legacy");
    expect(result.tools).toHaveLength(5);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "orient_wiki",
      "get_agent_pulse",
      "list_active_capabilities",
      "search_capabilities",
      "call_endpoint",
    ]);
  } finally {
    await client.close();
  }
}, 15_000);

test("serves MCP 2026-07-28 clients", async () => {
  const client = await connect("modern");
  try {
    const result = await client.listTools();
    expect(client.getProtocolEra()).toBe("modern");
    expect(result.tools).toHaveLength(5);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "orient_wiki",
      "get_agent_pulse",
      "list_active_capabilities",
      "search_capabilities",
      "call_endpoint",
    ]);
  } finally {
    await client.close();
  }
}, 15_000);

test("compiled stdio server completes the bounded organization discovery route", async () => {
  const client = await connect("modern");
  try {
    const orientation = await client.callTool({ name: "orient_wiki", arguments: { maxChars: 4000 } });
    const orientationValue = JSON.parse(String((orientation.content as any)[0]?.text || "{}"));
    expect(orientationValue.protocol).toBe("mcpvault-llm-wiki/v1");
    expect(orientationValue.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: expect.any(String), reason: expect.any(String) }),
    ]));

    const discovery = await client.callTool({ name: "search_capabilities", arguments: { query: "wiki home", limit: 3, maxChars: 6000 } });
    const discoveryValue = JSON.parse(String((discovery.content as any)[0]?.text || "{}"));
    expect(discoveryValue.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpointId: "wiki.home", available: true, input: expect.any(Object) }),
    ]));

    const home = await client.callTool({ name: "call_endpoint", arguments: { endpointId: "wiki.home", arguments: { limit: 5, maxChars: 4000 } } });
    const homeValue = JSON.parse(String((home.content as any)[0]?.text || "{}"));
    expect(homeValue).toMatchObject({ suggestedHomePath: "Home.md", suggestedIndexPath: "JDex.md", counts: expect.any(Object), nextAction: { endpointId: expect.any(String) } });
  } finally {
    await client.close();
  }
}, 20_000);
