/**
 * Hono application factory for the Shibumi-stack MCPVault website.
 *
 * Phase 1 skeleton: /healthz, static serving, security headers, request
 * logging, error handling, and the dedicated video route. No pages yet.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { join, normalize, sep } from "node:path";
import { registerFeaturesRoute } from "./routes/features";
import { registerHomeRoute } from "./routes/home";
import { registerSeoRoutes, SITE_URL } from "./routes/seo";
import { registerVideoRoutes } from "./routes/video";

export interface AppOptions {
  /** Directory served for static assets and video. Defaults to ../public. */
  publicDir?: string;
  /** Directory served for plain CSS under /styles/*. Defaults to ./styles. */
  stylesDir?: string;
  /** Base URL used to build sitemap.xml/robots.txt. Defaults to production. */
  siteUrl?: string;
}

const STATIC_CACHE_CONTROL = "public, max-age=3600";

/** Minimal request logger; silent under bun test. */
function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now();
    await next();
    if (process.env.NODE_ENV !== "test") {
      const durationMs = (performance.now() - startedAt).toFixed(1);
      console.log(
        `${new Date().toISOString()} ${c.req.method} ${c.req.path} ${c.res.status} ${durationMs}ms`,
      );
    }
  };
}

export function createApp(options: AppOptions = {}): Hono {
  const publicDir = options.publicDir ?? join(import.meta.dir, "..", "public");
  const stylesDir = options.stylesDir ?? join(import.meta.dir, "styles");
  const siteUrl = options.siteUrl ?? SITE_URL;
  const app = new Hono();

  app.use(requestLogger());
  // Defaults only for now; a strict CSP lands with the pages (Alpine CSP build).
  app.use(secureHeaders());

  app.get("/healthz", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ status: "ok" });
  });

  // Video before generic static: Range support via Bun.file().slice(),
  // deliberately not hono serveStatic (incomplete Bun Range support).
  registerVideoRoutes(app, publicDir);

  // Explicit sitemap.xml/robots.txt routes; Astro's sitemap integration
  // does not carry over (see routes/seo.ts for why this can't be assumed).
  registerSeoRoutes(app, siteUrl);

  // Home page (Phase 2, group 2). Registered before generic static serving
  // so "/" resolves to the page, not a directory-index lookup.
  registerHomeRoute(app, publicDir);

  // Features page (Phase 2, group 3).
  registerFeaturesRoute(app, publicDir);

  // Plain CSS under /styles/*, rooted and traversal-safe, same shape as the
  // generic static handler below but scoped to src/styles (source == the
  // served asset; there is no build/bundle step for this plain-CSS approach).
  app.on(["GET", "HEAD"], "/styles/*", async (c, next) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("Bad Request", 400);
    }
    if (pathname.includes("\0")) return c.text("Bad Request", 400);

    const relative = pathname.slice("/styles".length);
    const filePath = normalize(join(stylesDir, relative));
    if (filePath !== stylesDir && !filePath.startsWith(stylesDir + sep)) {
      return c.notFound();
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) return await next();

    const headers = new Headers({
      "content-type": "text/css; charset=utf-8",
      "content-length": String(file.size),
      "cache-control": STATIC_CACHE_CONTROL,
    });
    const body = c.req.method === "HEAD" ? null : file;
    return new Response(body, { status: 200, headers });
  });

  // Generic static serving from publicDir, rooted and traversal-safe.
  app.on(["GET", "HEAD"], "/*", async (c, next) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("Bad Request", 400);
    }
    if (pathname.includes("\0")) return c.text("Bad Request", 400);

    const filePath = normalize(join(publicDir, pathname));
    if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) {
      return c.notFound();
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) return await next();

    const headers = new Headers({
      "content-type": file.type || "application/octet-stream",
      "content-length": String(file.size),
      "cache-control": STATIC_CACHE_CONTROL,
    });
    const body = c.req.method === "HEAD" ? null : file;
    return new Response(body, { status: 200, headers });
  });

  app.notFound((c) => c.text("Not Found", 404));

  app.onError((err, c) => {
    console.error(`unhandled error on ${c.req.method} ${c.req.path}:`, err);
    return c.text("Internal Server Error", 500);
  });

  return app;
}

export default createApp();
