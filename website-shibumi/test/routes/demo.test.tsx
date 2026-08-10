/**
 * Route assertions for `GET /demo/` (Phase 2, group 7 -- "demo shell and
 * response examples, leaving interactivity for Phase 3").
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { packageVersion } from "../../src/lib/version";

let publicDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), "shibumi-demo-test-"));
  await writeFile(join(publicDir, "demo.md"), "# MCPVault Interactive Demo\n\nMarkdown counterpart fixture.\n");
  app = createApp({ publicDir });
});

afterAll(async () => {
  await rm(publicDir, { recursive: true, force: true });
});

describe("GET /demo/ (HTML)", () => {
  test("responds 200 text/html", async () => {
    const res = await app.request("/demo/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("renders the shared shell around the page", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain('data-component="nav"');
    expect(body).toContain('data-component="footer"');
    expect(body).toContain('data-page="demo"');
  });

  test("sets page-specific title, description, and canonical", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain("<title>Demo | MCPVault</title>");
    expect(body).toContain('content="See MCPVault in action. Interactive examples showing how AI assistants read, write, search, and manage your Obsidian vault."');
    expect(body).toContain('<link rel="canonical" href="https://mcpvault.org/demo"/>');
  });

  test("loads the page-specific stylesheet after the shared one", async () => {
    const body = await (await app.request("/demo/")).text();
    const sharedIndex = body.indexOf('href="/styles/shared.css"');
    const pageIndex = body.indexOf('href="/styles/demo.css"');
    expect(sharedIndex).toBeGreaterThan(-1);
    expect(pageIndex).toBeGreaterThan(sharedIndex);
  });

  test("renders every example tab", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain('data-component="interactive-demo"');
    expect(body).toContain("See It In Action");
    expect(body).toContain('data-tab="patch"');
    expect(body).toContain('data-tab="write"');
    expect(body).toContain('data-tab="read_multiple"');
    expect(body).toContain('data-tab="frontmatter"');
    expect(body).toContain('data-tab="search"');
  });

  test("only the first example panel is visible without JavaScript", async () => {
    const body = await (await app.request("/demo/")).text();
    const patchIndex = body.indexOf('data-content="patch"');
    const writeIndex = body.indexOf('data-content="write"');
    expect(patchIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(-1);

    const patchOpenTag = body.slice(body.lastIndexOf("<div", patchIndex), patchIndex);
    const writeOpenTag = body.slice(body.lastIndexOf("<div", writeIndex), writeIndex);
    expect(patchOpenTag).not.toContain("hidden");
    expect(writeOpenTag).toContain("hidden");
  });

  test("renders every panel's user prompt and AI response text", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain("Add the equation for energy-mass equivalence to my physics notes");
    expect(body).toContain("Create a quick note about today");
    expect(body).toContain("Read all my book club notes and give me a summary");
    expect(body).toContain("Update the status and add tags to my project planning note");
    expect(body).toContain('Search for &quot;React hooks&quot; in my notes');
    expect(body).toContain("Done! Added Einstein&#39;s equation to your notes.");
  });

  test("renders syntax-highlighted JSON for the response code blocks", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain("demo-response-code");
    expect(body).toContain("patch_note");
    expect(body).toContain("Physics/Relativity.md");
  });

  test("renders the Technical Details section for every panel", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain("Technical Details");
    expect(body).toContain("MCP server used patch_note for efficient partial update");
    expect(body).toContain("YAML is validated before writing to prevent corruption");
  });

  test("renders the Get Started Now CTA linking to /install", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain('href="/install"');
    expect(body).toContain("Get Started Now");
  });

  test("renders the injected package version in the structured data", async () => {
    const body = await (await app.request("/demo/")).text();
    expect(body).toContain(`"softwareVersion":"${packageVersion}"`);
  });
});

describe("GET /demo/ (Markdown negotiation)", () => {
  test("Accept: text/markdown without text/html serves the Markdown counterpart", async () => {
    const res = await app.request("/demo/", { headers: { accept: "text/markdown" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("Markdown counterpart fixture.");
  });

  test("a normal browser Accept header still gets the rendered page", async () => {
    const res = await app.request("/demo/", {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("falls back to the HTML page when demo.md is missing", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "shibumi-demo-empty-"));
    const emptyApp = createApp({ publicDir: emptyDir });
    const res = await emptyApp.request("/demo/", { headers: { accept: "text/markdown" } });
    expect(res.headers.get("content-type")).toContain("text/html");
    await rm(emptyDir, { recursive: true, force: true });
  });
});

describe("GET /styles/demo.css", () => {
  test("serves the page stylesheet with a CSS content type", async () => {
    const res = await app.request("/styles/demo.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const body = await res.text();
    expect(body).toContain('[data-component="interactive-demo"]');
  });
});

describe("GET /demo (no trailing slash)", () => {
  test("301s to the trailing-slash form", async () => {
    const res = await app.request("/demo", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toContain("/demo/");
  });
});

describe("GET /demo/ (unsupported method)", () => {
  test("POST is not treated as a page route", async () => {
    const res = await app.request("/demo/", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
