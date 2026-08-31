import { test, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./createServer.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

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

test("server registers 22 tools", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const result = await client.listTools();
  expect(result.tools).toHaveLength(22);

  const toolNames = result.tools.map((t) => t.name).sort();
  expect(toolNames).toEqual([
    "delete_note",
    "find_orphan_notes",
    "find_unresolved_links",
    "get_backlinks",
    "get_frontmatter",
    "get_note_outline",
    "get_notes_info",
    "get_outlinks",
    "get_vault_stats",
    "list_all_tags",
    "list_directory",
    "manage_tags",
    "move_file",
    "move_note",
    "patch_note",
    "read_multiple_notes",
    "read_note",
    "read_note_lines",
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
      arguments: { document: "Missing" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text as string;
    expect(text).toContain("Missing");
    expect(text).toContain("search_notes");
    const sc = result.structuredContent as any;
    expect(sc.document).toBe("Missing");
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link single match omits alternatives", async () => {
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
    expect("alternatives" in sc).toBe(false);
    expect(sc.ambiguous).toBeUndefined();
    expect(sc.matches).toBeUndefined();
  } finally {
    await client.close();
    await server.close();
  }
});

test("wiki_link multi match resolves first sorted path and lists alternatives", async () => {
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
    expect(sc.path).toBe("Note.md");
    expect(sc.alternatives).toEqual(["deep/Note.md"]);
    expect(sc.ambiguous).toBeUndefined();
    expect(sc.matches).toBeUndefined();
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

test("wiki_link resolves path-qualified link to the exact file", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Note.md"), "# Root Note");
    await mkdir(join(testVaultPath, "deep"), { recursive: true });
    await writeFile(join(testVaultPath, "deep/Note.md"), "# Deep Note");
    const result = await client.callTool({
      name: "wiki_link",
      arguments: { document: "[[deep/Note]]" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as any;
    expect(sc.document).toBe("deep/Note");
    expect(sc.path).toBe("deep/Note.md");
    expect("alternatives" in sc).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("read-only mode exposes read tools and rejects every vault mutation", async () => {
  await writeFile(join(testVaultPath, "existing.md"), "# Existing\n\nSafe content");

  const server = createServer(testVaultPath, {
    version: "1.0.0",
    readOnly: true,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "read-only-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  try {
    const listedTools = await client.listTools();
    const toolNames = listedTools.tools.map((tool) => tool.name);
    expect(toolNames).toHaveLength(15);
    expect(toolNames).toContain("read_note");
    expect(toolNames).toContain("search_notes");
    expect(toolNames).not.toContain("write_note");
    expect(toolNames).not.toContain("manage_tags");

    const readResult = await client.callTool({
      name: "read_note",
      arguments: { path: "existing.md" },
    });
    expect(readResult.isError).toBeFalsy();
    expect((readResult.content as any)[0].text).toContain("Safe content");

    const mutations = [
      { name: "write_note", arguments: { path: "blocked.md", content: "blocked" } },
      { name: "patch_note", arguments: { path: "existing.md", oldString: "Safe", newString: "Changed" } },
      { name: "delete_note", arguments: { path: "existing.md", confirmPath: "existing.md" } },
      { name: "move_note", arguments: { oldPath: "existing.md", newPath: "moved.md" } },
      { name: "move_file", arguments: { oldPath: "existing.md", newPath: "moved.md", confirmOldPath: "existing.md", confirmNewPath: "moved.md" } },
      { name: "update_frontmatter", arguments: { path: "existing.md", frontmatter: { status: "changed" } } },
      { name: "manage_tags", arguments: { path: "existing.md", operation: "list" } },
    ];

    for (const mutation of mutations) {
      const result = await client.callTool(mutation);
      expect(result.isError, `${mutation.name} should be blocked`).toBe(true);
      expect((result.content as any)[0].text).toContain("read-only mode");
    }

    await expect(readFile(join(testVaultPath, "blocked.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(testVaultPath, "existing.md"), "utf8")).toBe(
      "# Existing\n\nSafe content",
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test("find_orphan_notes excludes linked notes and self-links", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Linked.md"), "linked");
    await writeFile(join(testVaultPath, "Source.md"), "[[Linked]]");
    await writeFile(join(testVaultPath, "Self.md"), "[[Self]]");
    await writeFile(join(testVaultPath, "Orphan.md"), "No incoming links");

    const result = await client.callTool({ name: "find_orphan_notes", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toEqual({
      orphans: [
        { path: "Orphan.md", incomingLinks: 0 },
        { path: "Self.md", incomingLinks: 0 },
        { path: "Source.md", incomingLinks: 0 },
      ],
      total: 3,
      truncated: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("find_unresolved_links reports only broken wikilinks", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Target.md"), "target");
    await writeFile(join(testVaultPath, "asset.png"), "not markdown");
    await writeFile(join(testVaultPath, "Source.md"), [
      "Valid: [[Target]].",
      "Attachment: ![[asset.png]].",
      "Broken: [[Missing#Heading|display]].",
      "```md",
      "[[Ignored]]",
      "```",
    ].join("\n"));

    const result = await client.callTool({ name: "find_unresolved_links", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toEqual({
      unresolved: [{
        path: "Source.md",
        line: 3,
        link: "[[Missing#Heading|display]]",
        target: "Missing",
        context: "Broken: [[Missing#Heading|display]].",
      }],
      total: 1,
      truncated: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("get_outlinks returns destinations and ignores fenced examples", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Source.md"), [
      "See [[Target|the target]].",
      "Embed: ![[folder/Other#Details]].",
      "```md",
      "[[Ignored]]",
      "```",
    ].join("\n"));

    const result = await client.callTool({
      name: "get_outlinks",
      arguments: { path: "Source.md" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toEqual({
      source: "Source.md",
      outlinks: [
        {
          target: "Target",
          line: 1,
          link: "[[Target|the target]]",
          context: "See [[Target|the target]].",
        },
        {
          target: "folder/Other",
          line: 2,
          link: "![[folder/Other#Details]]",
          context: "Embed: ![[folder/Other#Details]].",
        },
      ],
      total: 2,
      truncated: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("get_backlinks returns wikilink occurrences with line context", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "Projects"), { recursive: true });
    await writeFile(join(testVaultPath, "Target.md"), "# Target");
    await writeFile(join(testVaultPath, "Projects", "Source.md"), [
      "# Source",
      "",
      "See [[Target|the target]].",
      "Embed: ![[Target#Details]].",
      "```md",
      "[[Target]]",
      "```",
    ].join("\n"));

    const result = await client.callTool({
      name: "get_backlinks",
      arguments: { path: "Target.md" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.target).toBe("Target.md");
    expect(parsed.total).toBe(2);
    expect(parsed.backlinks).toEqual([
      {
        path: "Projects/Source.md",
        line: 3,
        link: "[[Target|the target]]",
        context: "See [[Target|the target]].",
      },
      {
        path: "Projects/Source.md",
        line: 4,
        link: "![[Target#Details]]",
        context: "Embed: ![[Target#Details]].",
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
