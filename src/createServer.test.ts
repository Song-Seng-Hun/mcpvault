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

test("server registers 42 tools", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const result = await client.listTools();
  expect(result.tools).toHaveLength(42);

  const toolNames = result.tools.map((t) => t.name).sort();
  expect(toolNames).toEqual([
    "add_discussion_argument",
    "commit_changes",
    "compare_note_revisions",
    "create_agent_scope",
    "create_discussion",
    "daily_note",
    "delete_note",
    "find_orphan_notes",
    "find_unresolved_links",
    "get_backlinks",
    "get_daily_note",
    "get_discussion",
    "get_frontmatter",
    "get_note_history",
    "get_note_outline",
    "get_notes_info",
    "get_outlinks",
    "get_revision_status",
    "get_scope_context",
    "get_vault_stats",
    "handoff_agent_scope",
    "initialize_revision_history",
    "list_all_tags",
    "list_directory",
    "list_tasks",
    "manage_tags",
    "move_file",
    "move_note",
    "patch_note",
    "query_notes",
    "read_multiple_notes",
    "read_note",
    "read_note_lines",
    "read_scoped_note",
    "restore_note_revision",
    "resume_agent_scope",
    "search_notes",
    "search_scoped_notes",
    "update_discussion_status",
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
    expect(toolNames).toHaveLength(25);
    expect(toolNames).toContain("read_note");
    expect(toolNames).toContain("search_notes");
    expect(toolNames).not.toContain("write_note");
    expect(toolNames).not.toContain("manage_tags");
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("query_notes");
    expect(toolNames).toContain("get_revision_status");
    expect(toolNames).toContain("get_note_history");
    expect(toolNames).toContain("compare_note_revisions");
    expect(toolNames).not.toContain("commit_changes");
    expect(toolNames).not.toContain("restore_note_revision");
    expect(toolNames).toContain("get_scope_context");
    expect(toolNames).toContain("read_scoped_note");
    expect(toolNames).not.toContain("create_agent_scope");
    expect(toolNames).not.toContain("add_discussion_argument");

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
      { name: "daily_note", arguments: { action: "append", content: "blocked" } },
      { name: "initialize_revision_history", arguments: { confirm: true } },
      { name: "commit_changes", arguments: { reason: "blocked" } },
      { name: "restore_note_revision", arguments: { path: "existing.md", revision: "HEAD", confirmPath: "existing.md", confirmRevision: "HEAD" } },
      { name: "create_agent_scope", arguments: { agentId: "blocked", modelId: "codex", sessionId: "s1" } },
      { name: "handoff_agent_scope", arguments: { agentId: "blocked", fromSessionId: "s1", toSessionId: "s2", reason: "blocked", expectedGeneration: 1 } },
      { name: "resume_agent_scope", arguments: { agentId: "blocked", newSessionId: "s2", reason: "blocked", expectedGeneration: 1 } },
      { name: "create_discussion", arguments: { title: "blocked", createdBy: "codex", initialPosition: "blocked" } },
      { name: "add_discussion_argument", arguments: { discussionId: "blocked", actor: "codex", stance: "support", argument: "blocked", expectedRevision: "missing" } },
      { name: "update_discussion_status", arguments: { discussionId: "blocked", actor: "codex", status: "resolved", reason: "blocked", expectedRevision: "missing" } },
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

test("daily_note creates safely, appends, and reads the note", async () => {
  const { server, client } = await connectClient();
  try {
    const created = await client.callTool({
      name: "daily_note",
      arguments: { action: "create", date: "2026-09-01", folder: "Journal", content: "# Today" },
    });
    expect(created.isError).toBeFalsy();
    expect(JSON.parse((created.content as any)[0].text)).toMatchObject({
      action: "create", date: "2026-09-01", path: "Journal/2026-09-01.md", created: true,
    });

    const appended = await client.callTool({
      name: "daily_note",
      arguments: { action: "append", date: "2026-09-01", folder: "Journal", content: "- Done" },
    });
    expect(appended.isError).toBeFalsy();

    const read = await client.callTool({
      name: "get_daily_note",
      arguments: { date: "2026-09-01", folder: "Journal" },
    });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse((read.content as any)[0].text).content).toBe("# Today\n- Done");

    const noOverwrite = await client.callTool({
      name: "daily_note",
      arguments: { action: "create", date: "2026-09-01", folder: "Journal", content: "overwritten" },
    });
    expect(JSON.parse((noOverwrite.content as any)[0].text).created).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("list_tasks returns filtered tasks and ignores frontmatter and code fences", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "Projects"), { recursive: true });
    await writeFile(join(testVaultPath, "Projects/Plan.md"), [
      "---",
      "task: - [ ] not a body task",
      "---",
      "# Plan",
      "- [ ] Open task",
      "  - [x] Completed child",
      "```md",
      "- [ ] Ignored example",
      "```",
    ].join("\n"));

    const open = await client.callTool({ name: "list_tasks", arguments: { pathPrefix: "Projects" } });
    expect(open.isError).toBeFalsy();
    expect(JSON.parse((open.content as any)[0].text)).toEqual({
      tasks: [{ path: "Projects/Plan.md", line: 5, text: "Open task", status: "open" }],
      total: 1,
      truncated: false,
    });

    const all = await client.callTool({ name: "list_tasks", arguments: { status: "all" } });
    expect(JSON.parse((all.content as any)[0].text).tasks).toEqual([
      { path: "Projects/Plan.md", line: 5, text: "Open task", status: "open" },
      { path: "Projects/Plan.md", line: 6, text: "Completed child", status: "completed" },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("query_notes filters and sorts frontmatter through the MCP tool", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Alpha.md"), [
      "---",
      "status: active",
      "tags: [project, urgent]",
      "priority: 2",
      "---",
      "Alpha body",
    ].join("\n"));
    await writeFile(join(testVaultPath, "Beta.md"), [
      "---",
      "status: active",
      "tags: [project]",
      "priority: 1",
      "---",
      "Beta body",
    ].join("\n"));
    await writeFile(join(testVaultPath, "Archived.md"), "---\nstatus: archived\n---\nOld body");

    const result = await client.callTool({
      name: "query_notes",
      arguments: {
        filters: { status: "active", tags: "project" },
        sortBy: "priority",
        sortOrder: "desc",
        includeContent: true,
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toEqual({
      notes: [
        { path: "Alpha.md", frontmatter: { status: "active", tags: ["project", "urgent"], priority: 2 }, content: "Alpha body" },
        { path: "Beta.md", frontmatter: { status: "active", tags: ["project"], priority: 1 }, content: "Beta body" },
      ],
      total: 2,
      truncated: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test("revision tools checkpoint ordinary edits and restore one note safely", async () => {
  const { server, client } = await connectClient();
  try {
    const initialized = await client.callTool({
      name: "initialize_revision_history",
      arguments: { confirm: true },
    });
    expect(initialized.isError).toBeFalsy();

    await client.callTool({
      name: "write_note",
      arguments: { path: "Plan.md", content: "version one" },
    });
    const firstCommit = await client.callTool({
      name: "commit_changes",
      arguments: {
        reason: "Create the plan",
        authorName: "MCP Test",
        authorEmail: "mcp@example.com",
      },
    });
    expect(firstCommit.isError).toBeFalsy();
    const first = JSON.parse((firstCommit.content as any)[0].text);
    expect(first).toMatchObject({ committed: true, paths: ["Plan.md"] });

    await client.callTool({
      name: "patch_note",
      arguments: { path: "Plan.md", oldString: "one", newString: "two" },
    });
    const secondCommit = await client.callTool({
      name: "commit_changes",
      arguments: {
        reason: "Clarify the plan",
        authorName: "MCP Test",
        authorEmail: "mcp@example.com",
      },
    });
    const second = JSON.parse((secondCommit.content as any)[0].text);
    expect(second.committed).toBe(true);

    const history = await client.callTool({ name: "get_note_history", arguments: { path: "Plan.md" } });
    expect(JSON.parse((history.content as any)[0].text).map((entry: any) => entry.reason)).toEqual([
      "Clarify the plan",
      "Create the plan",
    ]);

    const comparison = await client.callTool({
      name: "compare_note_revisions",
      arguments: { path: "Plan.md", fromRevision: first.revision, toRevision: second.revision },
    });
    expect(JSON.parse((comparison.content as any)[0].text).diff).toContain("+version two");

    await client.callTool({
      name: "patch_note",
      arguments: { path: "Plan.md", oldString: "two", newString: "three" },
    });
    const protectedRestore = await client.callTool({
      name: "restore_note_revision",
      arguments: { path: "Plan.md", revision: first.revision, confirmPath: "Plan.md", confirmRevision: first.revision },
    });
    expect(protectedRestore.isError).toBe(true);
    expect((protectedRestore.content as any)[0].text).toContain("uncommitted change");

    const restored = await client.callTool({
      name: "restore_note_revision",
      arguments: {
        path: "Plan.md",
        revision: first.revision,
        confirmPath: "Plan.md",
        confirmRevision: first.revision,
        overwritePending: true,
      },
    });
    expect(restored.isError).toBeFalsy();
    const note = await client.callTool({ name: "read_note", arguments: { path: "Plan.md" } });
    expect(JSON.parse((note.content as any)[0].text).content).toBe("version one");
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
