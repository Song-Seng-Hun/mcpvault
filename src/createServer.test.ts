import { test, expect, beforeEach, afterEach } from "vitest";
import { createServer, getServerRuntime } from "./createServer.js";
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

test("server exposes only the dynamic control plane", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const result = await client.listTools();
  expect(result.tools.map((tool) => tool.name).sort()).toEqual([
    "call_endpoint",
    "get_agent_pulse",
    "list_active_capabilities",
    "orient_wiki",
    "search_capabilities",
  ]);

  const capabilities = await client.callTool({
    name: "search_capabilities",
    arguments: { query: "write note" },
  });
  const catalog = JSON.parse((capabilities.content as any)[0].text);
  expect(catalog.endpoints.some((endpoint: any) => endpoint.endpointId === "notes.write")).toBe(true);
  const catalogCapabilities = await client.callTool({
    name: "search_capabilities",
    arguments: { query: "wiki catalog" },
  });
  const wikiCatalog = JSON.parse((catalogCapabilities.content as any)[0].text);
  expect(wikiCatalog.endpoints.some((endpoint: any) => endpoint.endpointId === "wiki.catalog")).toBe(true);
  const neighborhoodCapabilities = await client.callTool({
    name: "search_capabilities",
    arguments: { query: "wiki neighborhood" },
  });
  const neighborhoodCatalog = JSON.parse((neighborhoodCapabilities.content as any)[0].text);
  expect(neighborhoodCatalog.endpoints.some((endpoint: any) => endpoint.endpointId === "wiki.neighborhood")).toBe(true);

  for (const endpointId of ["mcp.find_unresolved_links", "mcp.get_outlinks", "mcp.get_backlinks"]) {
    const linkCapabilities = await client.callTool({
      name: "search_capabilities",
      arguments: { query: endpointId, limit: 3, maxChars: 6000 },
    });
    const linkCatalog = JSON.parse((linkCapabilities.content as any)[0].text);
    const linkEndpoint = linkCatalog.endpoints.find((endpoint: any) => endpoint.endpointId === endpointId);
    expect(linkEndpoint?.description).toContain("relative Markdown");
    expect(linkEndpoint?.description).toContain("inline backtick");
    expect(linkEndpoint?.description).toContain("escaped");
    expect(linkEndpoint?.description).toContain("indented code");
  }

  const anonymousWrite = await client.callTool({
    name: "call_endpoint",
    arguments: {
      endpointId: "notes.write",
      arguments: { path: "anonymous.md", content: "# Must be attributed" },
    },
  });
  expect(anonymousWrite.isError).toBe(true);
  expect((anonymousWrite.content as any)[0].text).toContain("Authentication is required");

  const registration = await client.callTool({
    name: "call_endpoint",
    arguments: {
      endpointId: "auth.register",
      arguments: { accountId: "dynamic-owner", modelId: "codex", password: "dynamic-owner-password" },
    },
  });
  const accessToken = JSON.parse((registration.content as any)[0].text).accessToken;

  const written = await client.callTool({
    name: "call_endpoint",
    arguments: {
      endpointId: "notes.write",
      arguments: { path: "dynamic.md", content: "# Dynamic", accessToken },
    },
  });
  expect(written.isError).toBeFalsy();

  const neighborhood = await client.callTool({
    name: "call_endpoint",
    arguments: {
      endpointId: "wiki.neighborhood",
      arguments: { path: "dynamic.md", accessToken },
    },
  });
  expect(neighborhood.isError).toBeFalsy();
  expect(JSON.parse((neighborhood.content as any)[0].text).source.path).toBe("dynamic.md");

  const deleteCatalogResult = await client.callTool({ name: "search_capabilities", arguments: { query: "notes.delete_preview", limit: 3 } });
  const deleteCatalog = JSON.parse((deleteCatalogResult.content as any)[0].text);
  expect(deleteCatalog.endpoints).toEqual(expect.arrayContaining([expect.objectContaining({ endpointId: "notes.delete_preview" })]));
  await client.callTool({
    name: "call_endpoint",
    arguments: { endpointId: "notes.write", arguments: { path: "source.md", content: "# Source\n\n[[dynamic]]", accessToken } },
  });
  const deletePreview = await client.callTool({
    name: "call_endpoint",
    arguments: { endpointId: "notes.delete_preview", arguments: { path: "dynamic.md", accessToken } },
  });
  expect(deletePreview.isError).toBeFalsy();
  expect(JSON.parse((deletePreview.content as any)[0].text)).toMatchObject({
    path: "dynamic.md",
    total: 1,
    affectedLinks: [expect.objectContaining({ path: "source.md" })],
  });

  await client.close();
  await server.close();
});

test("dynamic control plane preserves compact onboarding and organization schemas", async () => {
  await writeFile(join(testVaultPath, '환영합니다!.md'), '# Welcome\nRead this first.');
  const server = createServer(testVaultPath, { version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'organization-surface-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const listed = await client.listTools();
    const orient = listed.tools.find(tool => tool.name === 'orient_wiki')!;
    expect(orient.description).toContain('exactly one primary action');
    expect((orient.inputSchema.properties as any).maxChars.default).toBe(3000);
    const orientation = await client.callTool({ name: 'orient_wiki', arguments: { maxChars: 512, prettyPrint: true } });
    const text = String((orientation.content as any)[0].text);
    const compact = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(512);
    expect(compact.commandCenterId).toBe('local');
    expect(compact.nextActions[0]).toMatchObject({ tool: 'notes.read', arguments: { path: '환영합니다!.md' } });

    const found = await client.callTool({ name: 'search_capabilities', arguments: { query: 'triage wiki note', limit: 3 } });
    const catalogText = String((found.content as any)[0].text);
    const catalog = JSON.parse(catalogText);
    expect(catalogText.length).toBeLessThanOrEqual(12000);
    const triage = catalog.endpoints.find((endpoint: any) => endpoint.endpointId === 'wiki.triage');
    expect(triage.schemaOmitted).not.toBe(true);
    expect(triage.input.properties).toEqual(expect.objectContaining({
      tags: expect.objectContaining({ type: 'array' }),
      timeEstimateMinutes: expect.objectContaining({ type: 'integer' }),
      energy: expect.objectContaining({ enum: ['low', 'medium', 'high'] }),
      effort: expect.objectContaining({ enum: ['low', 'medium', 'high'] }),
    }));
  } finally { await client.close(); await server.close(); }
});

test("static REST endpoint routes take precedence over notes.read path parameters", () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const runtime = getServerRuntime(server);
  expect(runtime?.endpointRegistry.resolveRoute("GET", "/api/notes/move-preview")?.endpoint.endpointId).toBe("notes.move_preview");
  expect(runtime?.endpointRegistry.resolveRoute("GET", "/api/notes/delete-preview")?.endpoint.endpointId).toBe("notes.delete_preview");
  expect(runtime?.endpointRegistry.resolveRoute("POST", "/api/notes/example.md/delete")?.endpoint.endpointId).toBe("notes.delete");
  expect(runtime?.endpointRegistry.resolveRoute("POST", "/api/notes/tasks")?.endpoint.endpointId).toBe("notes.task_update");
});

test("endpoint catalog makes every mutation POST and every read response-budgeted", () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const runtime = getServerRuntime(server)!;
  const descriptors = [...((runtime.endpointRegistry as any).descriptors.values() as Iterable<any>)];
  expect(descriptors.length).toBeGreaterThan(100);
  for (const endpoint of descriptors) {
    if (endpoint.mutating) {
      expect(endpoint.method, endpoint.endpointId).toBe("POST");
    } else {
      expect(endpoint.input.properties.maxChars, endpoint.endpointId).toMatchObject({
        type: "integer",
        default: expect.any(Number),
      });
    }
  }
  expect(runtime.endpointRegistry.resolve("mcp.add_discussion_argument")?.method).toBe("POST");
  expect(runtime.endpointRegistry.resolve("auth.change_password")?.method).toBe("POST");
  expect(runtime.endpointRegistry.resolve("mcp.ingest_source")?.method).toBe("POST");
  expect(runtime.endpointRegistry.resolve("mcp.moderate_content")?.method).toBe("POST");
});

test("server can read and write notes via tools", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  const registration = await client.callTool({
    name: "register_scope_account",
    arguments: { accountId: "notes-owner", modelId: "codex", password: "notes-owner-password" },
  });
  const accessToken = JSON.parse((registration.content as any)[0].text).accessToken as string;

  // Write a note
  await client.callTool({ name: "write_note", arguments: { path: "test.md", content: "# Hello World", accessToken } });

  // Read it back
  const result = await client.callTool({ name: "read_note", arguments: { path: "test.md" } });
  const resultText = (result.content as any)[0].text as string;
  expect(resultText.length).toBeLessThanOrEqual(12000);
  const parsed = JSON.parse(resultText);
  expect(parsed).toMatchObject({ path: "test.md" });
  expect(parsed.truncated).toBeUndefined();
  expect(parsed.content).toContain("Hello World");

  const unchanged = await client.callTool({ name: "read_note", arguments: { path: "test.md", knownRevision: parsed.revision } });
  expect(JSON.parse((unchanged.content as any)[0].text)).toEqual({
    notModified: true,
    path: "test.md",
    revision: parsed.revision,
  });

  const sync = await client.callTool({ name: "sync_note_revisions", arguments: { knownRevisions: { "test.md": parsed.revision } } });
  expect(JSON.parse((sync.content as any)[0].text)).toMatchObject({
    checked: 1,
    unchanged: 1,
    changes: [{ path: "test.md", state: "unchanged", revision: parsed.revision }],
  });

  const batch = await client.callTool({ name: "read_multiple_notes", arguments: { paths: ["test.md"], knownRevisions: { "test.md": parsed.revision } } });
  expect(JSON.parse((batch.content as any)[0].text)).toMatchObject({
    ok: [{ path: "test.md", unchanged: true, revision: parsed.revision }],
  });

  const unguardedUpdate = await client.callTool({ name: "write_note", arguments: { path: "test.md", content: "# Unsafe overwrite", accessToken } });
  expect(unguardedUpdate.isError).toBe(true);
  expect((unguardedUpdate.content as any)[0].text).toContain("requires expectedRevision");

  await client.callTool({ name: "write_note", arguments: { path: "test.md", content: "# Changed", expectedRevision: parsed.revision, accessToken } });
  const changedBatch = await client.callTool({ name: "read_multiple_notes", arguments: { paths: ["test.md"], knownRevisions: { "test.md": parsed.revision } } });
  const changedValue = JSON.parse((changedBatch.content as any)[0].text);
  expect(changedValue.ok[0].content).toContain("Changed");
  expect(changedValue.ok[0].revision).not.toBe(parsed.revision);
  expect(changedValue.ok[0].unchanged).toBeUndefined();

  const largeBody = `# Large note\n\n${"bounded context line\n".repeat(1800)}`;
  await client.callTool({
    name: "write_note",
    arguments: { path: "large.md", content: largeBody, expectedRevision: "missing", accessToken },
  });
  const defaultBounded = await client.callTool({ name: "read_note", arguments: { path: "large.md" } });
  const defaultBoundedText = (defaultBounded.content as any)[0].text as string;
  const defaultBoundedValue = JSON.parse(defaultBoundedText);
  expect(defaultBoundedText.length).toBeLessThanOrEqual(12000);
  expect(defaultBoundedValue).toMatchObject({
    path: "large.md",
    truncated: true,
    totalContentChars: largeBody.length,
    returnedContentChars: expect.any(Number),
    nextAction: { endpointId: "mcp.get_note_outline", arguments: { path: "large.md" } },
  });
  expect(defaultBoundedValue.content.length).toBe(defaultBoundedValue.returnedContentChars);
  expect(defaultBoundedValue.content.length).toBeGreaterThan(0);
  expect(defaultBoundedValue.revision).toMatch(/^[a-f0-9]{64}$/);

  const tinyBounded = await client.callTool({ name: "read_note", arguments: { path: "large.md", maxChars: 800 } });
  const tinyBoundedText = (tinyBounded.content as any)[0].text as string;
  const tinyBoundedValue = JSON.parse(tinyBoundedText);
  expect(tinyBoundedText.length).toBeLessThanOrEqual(800);
  expect(tinyBoundedValue).toMatchObject({ path: "large.md", truncated: true, totalContentChars: largeBody.length });
  expect(tinyBoundedValue.content.length).toBe(tinyBoundedValue.returnedContentChars);

  await client.callTool({
    name: "write_note",
    arguments: {
      path: "large-frontmatter.md",
      content: "# Metadata",
      frontmatter: { oversized: "m".repeat(30000) },
      expectedRevision: "missing",
      accessToken,
    },
  });
  const boundedFrontmatter = await client.callTool({ name: "get_frontmatter", arguments: { path: "large-frontmatter.md" } });
  const boundedFrontmatterText = (boundedFrontmatter.content as any)[0].text as string;
  expect(boundedFrontmatterText.length).toBeLessThanOrEqual(12000);
  expect(JSON.parse(boundedFrontmatterText)).toMatchObject({ truncated: true, maxChars: 12000 });
  const tinyFrontmatter = await client.callTool({ name: "get_frontmatter", arguments: { path: "large-frontmatter.md", maxChars: 1024 } });
  const tinyFrontmatterText = (tinyFrontmatter.content as any)[0].text as string;
  expect(tinyFrontmatterText.length).toBeLessThanOrEqual(1024);
  expect(JSON.parse(tinyFrontmatterText)).toMatchObject({ truncated: true, maxChars: 1024 });

  const lineWindow = await client.callTool({
    name: "read_note_lines",
    arguments: { path: "large.md", startLine: 1, endLine: 1802 },
  });
  const lineWindowText = (lineWindow.content as any)[0].text as string;
  const lineWindowValue = JSON.parse(lineWindowText);
  expect(lineWindowText.length).toBeLessThanOrEqual(6000);
  expect(lineWindowValue).toMatchObject({
    path: "large.md",
    revision: defaultBoundedValue.revision,
    startLine: 1,
    totalLines: expect.any(Number),
    truncated: true,
    nextAction: { endpointId: "mcp.read_note_lines", arguments: { path: "large.md" } },
  });
  const continuedLines = await client.callTool({ name: "read_note_lines", arguments: lineWindowValue.nextAction.arguments });
  const continuedValue = JSON.parse((continuedLines.content as any)[0].text);
  expect(lineWindowValue.content + continuedValue.content).toBe(largeBody.slice(0, lineWindowValue.content.length + continuedValue.content.length));

  const manyHeadings = Array.from({ length: 300 }, (_, index) => `## ${index.toString().padStart(3, "0")} ${"descriptive heading ".repeat(8)}`).join("\n");
  await client.callTool({
    name: "write_note",
    arguments: { path: "outline-heavy.md", content: manyHeadings, expectedRevision: "missing", accessToken },
  });
  const outline = await client.callTool({ name: "get_note_outline", arguments: { path: "outline-heavy.md" } });
  const outlineText = (outline.content as any)[0].text as string;
  const outlineValue = JSON.parse(outlineText);
  expect(outlineText.length).toBeLessThanOrEqual(4000);
  expect(outlineValue).toMatchObject({
    path: "outline-heavy.md",
    totalHeadings: 300,
    returnedHeadings: expect.any(Number),
    truncated: true,
    nextAction: { endpointId: "mcp.get_note_outline", arguments: { path: "outline-heavy.md" } },
  });
  expect(outlineValue.returnedHeadings).toBeGreaterThan(0);
  const nextOutline = await client.callTool({ name: "get_note_outline", arguments: outlineValue.nextAction.arguments });
  const nextOutlineValue = JSON.parse((nextOutline.content as any)[0].text);
  expect(nextOutlineValue.headings[0].line).toBeGreaterThan(outlineValue.headings.at(-1).line);

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

test("directory and graph navigation reads are bounded and resumable", async () => {
  await mkdir(join(testVaultPath, "Pages"), { recursive: true });
  await Promise.all(Array.from({ length: 70 }, (_, index) => writeFile(
    join(testVaultPath, "Pages", `page-${index.toString().padStart(3, "0")}-${"x".repeat(24)}.md`),
    `# Page ${index}`,
  )));
  const links = Array.from({ length: 90 }, (_, index) => `[[Target]] trailing context ${index} ${"context ".repeat(80)}`).join("\n");
  await writeFile(join(testVaultPath, "Target.md"), "# Target");
  await writeFile(join(testVaultPath, "Links.md"), links);
  const { server, client } = await connectClient();
  try {
    const directory = await client.callTool({ name: "list_directory", arguments: { path: "Pages", maxChars: 1024 } });
    const directoryText = (directory.content as any)[0].text as string;
    const directoryValue = JSON.parse(directoryText);
    expect(directoryText.length).toBeLessThanOrEqual(1024);
    expect(directoryValue).toMatchObject({ path: "Pages", totalEntries: 70, truncated: true, nextAction: { endpointId: "mcp.list_directory" } });
    const directoryNext = await client.callTool({ name: "list_directory", arguments: directoryValue.nextAction.arguments });
    const directoryNextValue = JSON.parse((directoryNext.content as any)[0].text);
    expect(directoryNextValue.offset).toBe(directoryValue.returned);
    expect(new Set([...directoryValue.files, ...directoryNextValue.files]).size).toBe(directoryValue.files.length + directoryNextValue.files.length);

    const backlinks = await client.callTool({ name: "get_backlinks", arguments: { path: "Target.md", maxChars: 1200 } });
    const backlinksText = (backlinks.content as any)[0].text as string;
    const backlinksValue = JSON.parse(backlinksText);
    expect(backlinksText.length).toBeLessThanOrEqual(1200);
    expect(backlinksValue).toMatchObject({ total: 90, truncated: true, nextAction: { endpointId: "mcp.get_backlinks" } });
    expect(backlinksValue.backlinks[0]).toMatchObject({ fieldsTruncated: true });
    const backlinksNext = await client.callTool({ name: "get_backlinks", arguments: backlinksValue.nextAction.arguments });
    const backlinksNextValue = JSON.parse((backlinksNext.content as any)[0].text);
    expect(backlinksNextValue.offset).toBe(backlinksValue.returned);
    expect(backlinksNextValue.backlinks[0].line).toBeGreaterThan(backlinksValue.backlinks.at(-1).line);
  } finally {
    await client.close();
    await server.close();
  }
});

async function connectClient() {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const registration = await client.callTool({
    name: "register_scope_account",
    arguments: { accountId: "test-owner", modelId: "codex", password: "test-owner-password" },
  });
  const accessToken = JSON.parse((registration.content as any)[0].text).accessToken as string;
  return { server, client, accessToken };
}

test("search_notes bounds output and prioritizes Wiki notes", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "_wiki"), { recursive: true });
    await writeFile(join(testVaultPath, "ordinary.md"), "# Ordinary\n\nneedle needle needle needle.");
    await writeFile(join(testVaultPath, "_wiki", "knowledge.md"), "---\nllm_wiki_type: knowledge\n---\n\n# Knowledge\n\nneedle once.");

    const result = await client.callTool({ name: "search_notes", arguments: { query: "needle", limit: 20, maxChars: 512 } });
    const text = (result.content as any)[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed[0]).toMatchObject({ p: "_wiki/knowledge.md", wk: true });
    expect(text.length).toBeLessThanOrEqual(512);
  } finally {
    await client.close();
    await server.close();
  }
});

test("search capability documents explicit authority confidence without implying relations from embeddings", async () => {
  const server = createServer(testVaultPath, { version: "1.0.0" });
  const runtime = getServerRuntime(server)!;
  runtime.ensureEndpointRegistry();
  const endpoint = runtime.endpointRegistry.resolve('wiki.search')!;
  expect(endpoint.description).toContain('same_as');
  expect(endpoint.description).toContain('close_match');
  expect(endpoint.description).toContain('authority_id');
  expect(endpoint.description).toContain('embeddings never fabricate');
  expect((endpoint.input.properties as any).expandAuthority.description).toContain('same_as');
  await server.close();
});

test("external Markdown edits invalidate the Wiki catalog without a restart", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "_wiki"), { recursive: true });
    const before = await client.callTool({ name: "get_wiki_catalog", arguments: {} });
    expect(JSON.parse((before.content as any)[0].text).schemaPresent).toBe(false);

    await writeFile(join(testVaultPath, "_wiki", "SCHEMA.md"), "---\nllm_wiki_type: schema\nschema_version: 1\n---\n# Schema");
    await new Promise((resolve) => setTimeout(resolve, 150));

    const after = await client.callTool({ name: "get_wiki_catalog", arguments: {} });
    const catalog = JSON.parse((after.content as any)[0].text);
    expect(catalog.schemaPresent).toBe(true);
    expect(catalog.entries).toContainEqual({ path: "_wiki/SCHEMA.md", type: "schema" });
  } finally {
    await client.close();
    await server.close();
  }
});

test("semantic search is optional and falls back to lexical results", async () => {
  const { server, client, accessToken } = await connectClient();
  try {
    await client.callTool({ name: "write_note", arguments: { path: "korean.md", content: "# 한국어\n\n벡터 검색 장애에도 원문 검색은 계속되어야 합니다.", accessToken } });
    const result = await client.callTool({ name: "search_notes", arguments: { query: "벡터 검색", semantic: true, maxChars: 512 } });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed[0]?.p).toBe("korean.md");

    const status = await client.callTool({ name: "semantic_search_status", arguments: {} });
    const statusJson = JSON.parse((status.content as any)[0].text);
    expect(statusJson).toMatchObject({ enabled: true, model: "Xenova/multilingual-e5-small" });
  } finally {
    await client.close();
    await server.close();
  }
});

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
  await writeFile(join(testVaultPath, "existing.md"), "---\nauthority_scheme: local-topics\nauthority_id: AI.1\npreferred_term: Existing\n---\n# Existing\n\nSafe content");

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
    expect(toolNames).toEqual([
      "orient_wiki",
      "get_agent_pulse",
      "list_active_capabilities",
      "search_capabilities",
      "call_endpoint",
    ]);

    const readResult = await client.callTool({
      name: "read_note",
      arguments: { path: "existing.md" },
    });
    expect(readResult.isError).toBeFalsy();
    expect((readResult.content as any)[0].text).toContain("Safe content");

    const shelfResult = await client.callTool({
      name: 'call_endpoint',
      arguments: { endpointId: 'wiki.authority_map', arguments: { scheme: 'local-topics', limit: 5, maxChars: 2400 } },
    });
    expect(shelfResult.isError).toBeFalsy();
    expect(JSON.parse(String((shelfResult.content as any)[0].text))).toMatchObject({
      scheme: 'local-topics', entries: [expect.objectContaining({ authorityId: 'AI.1' })],
    });

    const reciprocalApplyResult = await client.callTool({
      name: 'call_endpoint',
      arguments: { endpointId: 'notes.change_set', arguments: {
        changes: [{ path: 'existing.md', frontmatter: { set: { related: ['[[other]]'] } } }],
        dryRun: false,
      } },
    });
    expect(reciprocalApplyResult.isError).toBe(true);
    expect(String((reciprocalApplyResult.content as any)[0].text)).toContain('read-only mode');

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
      { name: "register_scope_account", arguments: { accountId: "blocked", modelId: "blocked", password: "blocked-password" } },
      { name: "change_scope_password", arguments: { accessToken: "blocked", currentPassword: "blocked-password", newPassword: "blocked-password-2" } },
      { name: "initialize_llm_wiki", arguments: { actor: "blocked" } },
      { name: "ingest_source", arguments: { title: "blocked", content: "blocked", capturedBy: "blocked" } },
      { name: "publish_knowledge", arguments: { path: "blocked.md", content: "blocked", evidencePaths: ["source.md"], expectedRevision: "missing", author: "blocked" } },
      { name: "report_wiki_issue", arguments: { kind: "other", title: "blocked", description: "blocked", reportedBy: "blocked" } },
      { name: "resolve_wiki_issue", arguments: { path: "blocked.md", resolution: "blocked", expectedRevision: "missing", actor: "blocked" } },
      { name: "write_journal_entry", arguments: { content: "blocked" } },
      { name: "publish_blog_post", arguments: { slug: "blocked", title: "blocked", content: "blocked", expectedRevision: "missing" } },
      { name: "comment_on_blog_post", arguments: { slug: "blocked", content: "blocked" } },
      { name: "edit_blog_comment", arguments: { slug: "blocked", commentId: "blocked", content: "blocked", expectedRevision: "blocked" } },
      { name: "delete_blog_comment", arguments: { slug: "blocked", commentId: "blocked", expectedRevision: "blocked" } },
      { name: "create_chat_room", arguments: { roomId: "blocked", title: "blocked", expectedRevision: "missing" } },
      { name: "send_chat_message", arguments: { roomId: "blocked", content: "blocked" } },
      { name: "edit_chat_message", arguments: { roomId: "blocked", messageId: "blocked", content: "blocked", expectedRevision: "blocked" } },
      { name: "delete_chat_message", arguments: { roomId: "blocked", messageId: "blocked", expectedRevision: "blocked" } },
      { name: "archive_chat_room", arguments: { roomId: "blocked", expectedRevision: "blocked" } },
      { name: "send_whisper", arguments: { to: "blocked", content: "blocked" } },
      { name: "update_community_status", arguments: { targetType: "post", slug: "blocked", workflowStatus: "resolved", expectedRevision: "missing" } },
      { name: "update_agent_capabilities", arguments: { agentId: "blocked", capabilities: ["chat"], accessToken: "blocked" } },
      { name: "update_agent_profile", arguments: { expectedRevision: "missing", accessToken: "blocked" } },
      { name: "mark_notifications_read", arguments: { accessToken: "blocked" } },
      { name: "create_agent_task", arguments: { title: "blocked", description: "blocked", accessToken: "blocked" } },
      { name: "update_agent_task", arguments: { taskId: "blocked", expectedRevision: "blocked", accessToken: "blocked" } },
    ];

    for (const mutation of mutations) {
      const result = await client.callTool(mutation);
      expect(result.isError, `${mutation.name} should be blocked`).toBe(true);
      expect((result.content as any)[0].text).toContain("read-only mode");
    }

    await expect(readFile(join(testVaultPath, "blocked.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(testVaultPath, "existing.md"), "utf8")).toContain("Safe content");
  } finally {
    await client.close();
    await server.close();
  }
});

test("generic mutation tools cannot bypass managed community APIs", async () => {
  const { server, client, accessToken } = await connectClient();
  try {
    for (const path of [
      "Community/Posts/forbidden.md",
      "Community/Ideas/forbidden.md",
      "Community/Workshops/forbidden.md",
      "Community/Reactions/forbidden.md",
      "Community/Guestbooks/forbidden.md",
    ]) {
      const result = await client.callTool({ name: "write_note", arguments: { path, content: "forbidden", accessToken } });
      expect(result.isError).toBe(true);
      expect((result.content as any)[0].text).toContain("dedicated community tool");
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("daily_note creates safely, appends, and reads the note", async () => {
  const { server, client, accessToken } = await connectClient();
  try {
    const created = await client.callTool({
      name: "daily_note",
      arguments: { action: "create", date: "2026-09-01", folder: "Journal", content: "# Today", accessToken },
    });
    expect(created.isError).toBeFalsy();
    expect(JSON.parse((created.content as any)[0].text)).toMatchObject({
      action: "create", date: "2026-09-01", path: "Journal/2026-09-01.md", created: true,
    });

    const appended = await client.callTool({
      name: "daily_note",
      arguments: { action: "append", date: "2026-09-01", folder: "Journal", content: "- Done", accessToken },
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
      arguments: { action: "create", date: "2026-09-01", folder: "Journal", content: "overwritten", accessToken },
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
    expect(JSON.parse((open.content as any)[0].text)).toMatchObject({
      tasks: [{ path: "Projects/Plan.md", line: 5, text: "Open task", status: "open" }],
      total: 1,
      truncated: false,
    });

    const all = await client.callTool({ name: "list_tasks", arguments: { status: "all" } });
    expect(JSON.parse((all.content as any)[0].text).tasks).toMatchObject([
      { path: "Projects/Plan.md", line: 5, text: "Open task", status: "open" },
      { path: "Projects/Plan.md", line: 6, text: "Completed child", status: "completed" },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("list_tasks keeps pathological task text inside an explicit response budget", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "Projects"), { recursive: true });
    await writeFile(join(testVaultPath, "Projects/Long task.md"), `- [ ] ${"context ".repeat(2000)}`);

    const capabilities = await client.callTool({
      name: "search_capabilities",
      arguments: { query: "list checkbox tasks", limit: 5, maxChars: 12000 },
    });
    const descriptor = JSON.parse((capabilities.content as any)[0].text).endpoints
      .find((endpoint: any) => endpoint.endpointId === "mcp.list_tasks");
    expect(descriptor.input.properties.maxChars).toMatchObject({ default: 4000, minimum: 512, maximum: 12000 });

    const response = await client.callTool({
      name: "list_tasks",
      arguments: { pathPrefix: "Projects/Long task.md", maxChars: 512 },
    });
    expect(response.isError).toBeFalsy();
    const text = String((response.content as any)[0].text);
    const value = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(512);
    expect(value).toMatchObject({
      tasks: [expect.objectContaining({
        path: "Projects/Long task.md",
        line: 1,
        status: "open",
        taskId: expect.stringMatching(/^task:content:/),
        textTruncated: true,
      })],
      total: 1,
      returned: 1,
      truncated: true,
    });
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
        { path: "Alpha.md", frontmatter: { status: "active", tags: ["project", "urgent"], priority: 2 }, revision: expect.stringMatching(/^[a-f0-9]{64}$/), content: "Alpha body" },
        { path: "Beta.md", frontmatter: { status: "active", tags: ["project"], priority: 1 }, revision: expect.stringMatching(/^[a-f0-9]{64}$/), content: "Beta body" },
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
  const { server, client, accessToken } = await connectClient();
  try {
    const initialized = await client.callTool({
      name: "initialize_revision_history",
      arguments: { confirm: true, accessToken },
    });
    expect(initialized.isError).toBeFalsy();

    await client.callTool({
      name: "write_note",
      arguments: { path: "Plan.md", content: "version one", accessToken },
    });
    const firstCommit = await client.callTool({
      name: "commit_changes",
      arguments: {
        reason: "Create the plan",
        authorName: "MCP Test",
        authorEmail: "mcp@example.com",
        accessToken,
      },
    });
    expect(firstCommit.isError).toBeFalsy();
    const first = JSON.parse((firstCommit.content as any)[0].text);
    expect(first).toMatchObject({ committed: true, paths: ["Plan.md"] });
    const firstNote = JSON.parse(((await client.callTool({ name: "read_note", arguments: { path: "Plan.md" } })).content as any)[0].text);

    await client.callTool({
      name: "patch_note",
      arguments: { path: "Plan.md", oldString: "one", newString: "two", expectedRevision: firstNote.revision, accessToken },
    });
    const secondCommit = await client.callTool({
      name: "commit_changes",
      arguments: {
        reason: "Clarify the plan",
        authorName: "MCP Test",
        authorEmail: "mcp@example.com",
        accessToken,
      },
    });
    const second = JSON.parse((secondCommit.content as any)[0].text);
    expect(second.committed).toBe(true);
    const secondNote = JSON.parse(((await client.callTool({ name: "read_note", arguments: { path: "Plan.md" } })).content as any)[0].text);

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
      arguments: { path: "Plan.md", oldString: "two", newString: "three", expectedRevision: secondNote.revision, accessToken },
    });
    const protectedRestore = await client.callTool({
      name: "restore_note_revision",
      arguments: { path: "Plan.md", revision: first.revision, confirmPath: "Plan.md", confirmRevision: first.revision, accessToken },
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
        accessToken,
      },
    });
    expect(restored.isError).toBeFalsy();
    const note = await client.callTool({ name: "read_note", arguments: { path: "Plan.md" } });
    expect(JSON.parse((note.content as any)[0].text).content).toBe("version one");
  } finally {
    await client.close();
    await server.close();
  }
}, 15000);

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

test("find_unresolved_links reports only real broken internal links", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Target.md"), "target");
    await writeFile(join(testVaultPath, "asset.png"), "not markdown");
    await writeFile(join(testVaultPath, "Source.md"), [
      "Valid: [[Target]].",
      "Attachment: ![[asset.png]].",
      "Broken: [[Missing#Heading|display]].",
      "Inline example: `[[InlineIgnored]]`.",
      "Escaped example: \\[[EscapedIgnored]].",
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
        targetHeading: "Heading",
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

test("get_outlinks returns destinations and ignores literal examples", async () => {
  const { server, client } = await connectClient();
  try {
    await writeFile(join(testVaultPath, "Source.md"), [
      "See [[Target|the target]].",
      "Embed: ![[folder/Other#Details]].",
      "Inline example: `[[InlineIgnored]]`.",
      "Escaped example: \\[[EscapedIgnored]].",
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
          targetHeading: "Details",
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

test("get_outlinks hides private note targets from public callers", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "_scopes", "models", "private-model"), { recursive: true });
    await writeFile(join(testVaultPath, "_scopes", "models", "private-model", "Secret.md"), "private\n");
    await writeFile(join(testVaultPath, "Source.md"), "A hidden reference: [[Secret]].\n");

    const result = await client.callTool({ name: "get_outlinks", arguments: { path: "Source.md" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toMatchObject({ outlinks: [], total: 0, truncated: false });
  } finally {
    await client.close();
    await server.close();
  }
});

test("get_backlinks returns real internal-link occurrences with line context", async () => {
  const { server, client } = await connectClient();
  try {
    await mkdir(join(testVaultPath, "Projects"), { recursive: true });
    await writeFile(join(testVaultPath, "Target.md"), "# Target");
    await writeFile(join(testVaultPath, "Projects", "Source.md"), [
      "# Source",
      "",
      "See [[Target|the target]].",
      "Embed: ![[Target#Details]].",
      "Inline example: `[[Target]]`.",
      "Escaped example: \\[[Target]].",
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
        heading: "Source",
      },
      {
        path: "Projects/Source.md",
        line: 4,
        link: "![[Target#Details]]",
        context: "Embed: ![[Target#Details]].",
        heading: "Source",
        targetHeading: "Details",
      },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
