import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import { buildRobotsTxt, buildSitemapXml, SITE_ROUTES } from "../../src/routes/seo";

const app = createApp({ siteUrl: "https://example.test" });

describe("GET /sitemap.xml", () => {
  test("returns 200 application/xml with every route", async () => {
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    for (const route of SITE_ROUTES) {
      expect(body).toContain(`<loc>https://example.test${route}</loc>`);
    }
  });

  test("matches the pure builder function (no drift between routes and content)", async () => {
    const res = await app.request("/sitemap.xml");
    const body = await res.text();
    expect(body).toBe(buildSitemapXml("https://example.test", SITE_ROUTES));
  });

  test("unsupported method is not treated as a page route", async () => {
    const res = await app.request("/sitemap.xml", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /robots.txt", () => {
  test("returns 200 text/plain and references the sitemap it actually serves", async () => {
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(body).toContain("Crawl-delay: 1");
  });

  test("matches the pure builder function", async () => {
    const res = await app.request("/robots.txt");
    expect(await res.text()).toBe(buildRobotsTxt("https://example.test"));
  });
});

describe("default siteUrl", () => {
  test("createApp() with no options points the sitemap at production", async () => {
    const res = await createApp().request("/sitemap.xml");
    const body = await res.text();
    expect(body).toContain("<loc>https://mcpvault.org/</loc>");
  });
});
