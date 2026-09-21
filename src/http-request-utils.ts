import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { guidanceError } from './guidance-runtime.js';

export const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;

export async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw guidanceError(new Error(`request body exceeds ${maxBytes} bytes`), 'guid-668226077e0f44fa');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host.trim().toLowerCase());
}

export function requestHost(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return undefined; }
}

export function originAllowed(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin;
  return typeof origin !== 'string' || allowedOrigins.includes(origin);
}

export function createRateLimiter(windowMs: number, maxRequests: number, maxBuckets: number): (key: string) => boolean {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      if (windows.size >= maxBuckets) {
        for (const [bucket, value] of windows) {
          if (now - value.startedAt >= windowMs) windows.delete(bucket);
          if (windows.size < maxBuckets) break;
        }
      }
      if (windows.size >= maxBuckets && !windows.has(key)) return false;
      windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= maxRequests) return false;
    current.count += 1;
    return true;
  };
}

export function configureHttpServer(server: HttpServer, maxConnections: number | undefined): void {
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = Math.min(Math.max(Math.trunc(maxConnections ?? 256), 1), 2_048);
}
