/**
 * Bun entrypoint: serves the Hono app with graceful shutdown.
 */
import app from "./src/app";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

const server = Bun.serve({
  port,
  hostname,
  fetch: app.fetch,
});

console.log(`website-shibumi listening on http://${hostname}:${port}`);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully`);
  await server.stop(); // stop accepting; let in-flight requests finish
  console.log("server stopped");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
