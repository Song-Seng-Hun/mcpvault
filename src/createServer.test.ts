import { test, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./createServer.js";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let testVaultPath: string;

beforeEach(async () => {
  testVaultPath = await mkdtemp(join(tmpdir(), "mcpvault-test-"));
});

afterEach(async () => {
  try {
    await rm(testVaultPath, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

test("createServer returns a Server instance", () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  expect(server).toBeDefined();
  expect(typeof server.connect).toBe("function");
});

test("server registers 16 tools", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const result = await client.listTools();
  expect(result.tools).toHaveLength(16);

  const toolNames = result.tools.map((t) => t.name).sort();
  expect(toolNames).toEqual([
    "delete_note",
    "get_frontmatter",
    "get_notes_info",
    "get_vault_stats",
    "list_all_tags",
    "list_directory",
    "manage_tags",
    "move_file",
    "move_note",
    "patch_note",
    "read_multiple_notes",
    "read_note",
    "search_notes",
    "update_frontmatter",
    "wiki_link",
    "write_note",
  ]);

  await client.close();
  await server.close();
});

test("server can read and write notes via tools", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Write a note
  await client.callTool({ name: "write_note", arguments: { path: "test.md", content: "# Hello World" } });

  // Read it back
  const result = await client.callTool({ name: "read_note", arguments: { path: "test.md" } });
  const parsed = JSON.parse((result.content as any)[0].text);
  expect(parsed.content).toContain("Hello World");

  await client.close();
  await server.close();
});

test("custom options are applied", () => {
  const server = createServer(testVaultPath, {
    name: "custom-name",
    version: "2.0.0",
  });
  expect(server).toBeDefined();
});

async function connectClient() {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { server, client };
}

test("wiki_link returns isError on invalid syntax (backslash in parsed)", async () => {
  const { server, client } = await connectClient();
  try {
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "[[Foo\\\\|Bar]]" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text as string;
    expect(text).toMatch(/Invalid wiki-link syntax/);
    expect((result.structuredContent as any).rawInput).toBe("[[Foo\\\\|Bar]]");
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link returns isError on zero match with document echo", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Other.md"), "# Other");
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "Missing", fragment: "Intro" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text as string;
    expect(text).toContain("Missing");
    expect(text).toContain("Intro");
    const sc = result.structuredContent as any;
    expect(sc.document).toBe("Missing");
    expect(sc.fragment).toBe("Intro");
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link single match returns matches with one entry and ambiguous false", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Note.md"), "# Note\n\nbody");
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "Note" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.document).toBe("Note");
    expect(sc.path).toBe("Note.md");
    expect(sc.ambiguous).toBe(false);
    expect(sc.matches).toEqual([{ path: "Note.md" }]);
    expect(sc.fragment).toBeUndefined();
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link multi match returns ambiguous true with winner at matches[0]", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Note.md"), "# Root Note");
    await mkdir(join(testVaultPath, "deep"), { recursive: true });
    await writeFile(join(testVaultPath, "deep/Note.md"), "# Deep Note");
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "[[Note]]" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.ambiguous).toBe(true);
    expect(sc.matches).toEqual([{ path: "Note.md" }, { path: "deep/Note.md" }]);
    expect(sc.path).toBe("Note.md");
    expect(sc.matches[0].path).toBe(sc.path);
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link unescapes table-authored \\| inside brackets", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "My Document.md"), "# My Document\n\ncontent");
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "[[My Document\\|Displayed]]" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.document).toBe("My Document");
    expect(sc.path).toBe("My Document.md");
  } finally {
    await client.close();
    await server.close();
  }
});
