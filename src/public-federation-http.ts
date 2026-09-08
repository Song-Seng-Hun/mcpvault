import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server as NetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import {
  PublicFederationHub,
  type PublicFederationEvent,
  type PublicFederationFeed,
  type PublicFederationHubOptions,
  type PublicFederationIdentity,
  type PublicModerationInput,
  type PublicPublishInput,
} from './public-federation.js';

const MAX_HTTP_BODY = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function loopback(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function bearer(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  const match = typeof value === 'string' ? value.match(/^Bearer\s+(.+)$/i) : undefined;
  return match?.[1];
}

async function jsonBody(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('request body exceeds the public federation limit');
    chunks.push(buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('request body must be valid JSON'); }
  if (!isRecord(value)) throw new Error('request body must be an object');
  return value;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

export interface PublicFederationClientOptions {
  baseUrl: string;
  authToken?: string;
}

export class PublicFederationHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'PublicFederationHttpError';
  }
}

export class PublicFederationClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;

  constructor(options: PublicFederationClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('baseUrl must use http or https');
    if (url.protocol === 'http:' && !loopback(url.hostname)) throw new Error('Public Federation client requires HTTPS for non-loopback URLs');
    if (url.username || url.password || url.search || url.hash) throw new Error('baseUrl must not contain credentials, query, or fragment');
    this.baseUrl = url.href.replace(/\/+$/, '');
    this.authToken = options.authToken ? String(options.authToken) : undefined;
    if (this.authToken && this.authToken.length > 4096) throw new Error('authToken is too long');
  }

  private async request<T>(path: string, init: RequestInit = {}, requiresWriteCredential = false): Promise<T> {
    if (requiresWriteCredential && !this.authToken) throw new Error('a write credential is required for this operation');
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { ...(this.authToken && { authorization: `Bearer ${this.authToken}` }), 'content-type': 'application/json', ...(init.headers || {}) },
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 8 * 1024 * 1024) throw new Error('Public Federation response exceeds its size limit');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let value: unknown;
    try { value = raw ? JSON.parse(raw) : {}; } catch { value = { error: raw }; }
    if (!response.ok) {
      const message = isRecord(value) && typeof value.error === 'string' ? value.error : `Public Federation HTTP ${response.status}`;
      throw new PublicFederationHttpError(message, response.status, response.status === 429 || response.status >= 500);
    }
    return value as T;
  }

  publish(input: PublicPublishInput, idempotencyKey: string): Promise<PublicFederationEvent> {
    return this.request('/v1/public/records', { method: 'POST', body: JSON.stringify({ input, idempotencyKey }) }, true);
  }

  moderate(input: PublicModerationInput, idempotencyKey: string): Promise<PublicFederationEvent> {
    return this.request('/v1/public/moderation', { method: 'POST', body: JSON.stringify({ input, idempotencyKey }) }, true);
  }

  getFeed(after = 0, limit = 50): Promise<PublicFederationFeed> {
    const params = new URLSearchParams({ after: String(after), limit: String(limit) });
    return this.request(`/v1/public/feed?${params}`);
  }
}

export interface PublicFederationHubHttpOptions extends Omit<PublicFederationHubOptions, 'signingPrivateKey'> {
  host?: string;
  port?: number;
  credentials: Record<string, PublicFederationIdentity>;
  signingKeyPath?: string;
  maxBodyBytes?: number;
  maxConnections?: number;
  tls?: { key: string | Buffer; cert: string | Buffer; ca?: string | Buffer; requestCert?: boolean; rejectUnauthorized?: boolean };
}

export interface PublicFederationHubHttpHandle {
  server: NetServer;
  host: string;
  port: number;
  hub: PublicFederationHub;
  close(): Promise<void>;
}

async function loadOrCreateSigningKey(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    return undefined;
  }
}

export async function startPublicFederationHub(root: string, options: PublicFederationHubHttpOptions): Promise<PublicFederationHubHttpHandle> {
  const resolvedRoot = resolve(root);
  const keyPath = resolve(options.signingKeyPath || join(resolvedRoot, 'signing-key.pem'));
  const existingKey = await loadOrCreateSigningKey(keyPath);
  const hub = new PublicFederationHub(resolvedRoot, {
    ...(options.hubId && { hubId: options.hubId }),
    ...(existingKey && { signingPrivateKey: existingKey }),
    ...(options.maxRecords !== undefined && { maxRecords: options.maxRecords }),
  });
  if (!existingKey) {
    await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
    try {
      await writeFile(keyPath, hub.exportSigningPrivateKey(), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      await hub.close();
      throw error;
    }
  }
  try {
    await hub.getFeed(0, 1);
  } catch (error) {
    await hub.close().catch(() => undefined);
    throw error;
  }
  const host = options.host || '127.0.0.1';
  if (!loopback(host) && !options.tls) {
    await hub.close();
    throw new Error('Public Federation HTTP requires TLS on non-loopback hosts');
  }
  const credentialEntries = Object.entries(options.credentials);
  if (credentialEntries.length === 0 || credentialEntries.some(([token]) => !token || token.length > 4096)) {
    await hub.close();
    throw new Error('at least one public federation credential is required');
  }
  const credentials = credentialEntries.map(([token, identity]) => ({ digest: tokenDigest(token), identity: { ...identity } }));
  const authenticate = (request: IncomingMessage): PublicFederationIdentity | undefined => {
    const token = bearer(request);
    if (!token || token.length > 4096) return undefined;
    const digest = tokenDigest(token);
    return credentials.find(candidate => timingSafeEqual(candidate.digest, digest))?.identity;
  };
  const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? MAX_HTTP_BODY), 1024), MAX_HTTP_BODY);
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url || '/', `http://${host}`);
      if (request.method === 'GET' && url.pathname === '/v1/public/feed') {
        sendJson(response, 200, await hub.getFeed(Number(url.searchParams.get('after') || 0), Number(url.searchParams.get('limit') || 50)));
        return;
      }
      const identity = authenticate(request);
      if (!identity) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/public/records') {
        const body = await jsonBody(request, maxBodyBytes);
        const extra = Object.keys(body).find(key => key !== 'input' && key !== 'idempotencyKey');
        if (extra) throw new Error(`unsupported transport field: ${extra}`);
        sendJson(response, 201, await hub.publish(body.input as PublicPublishInput, identity, String(body.idempotencyKey || '')));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/public/moderation') {
        const body = await jsonBody(request, maxBodyBytes);
        const extra = Object.keys(body).find(key => key !== 'input' && key !== 'idempotencyKey');
        if (extra) throw new Error(`unsupported transport field: ${extra}`);
        sendJson(response, 201, await hub.moderate(body.input as unknown as PublicModerationInput, identity, String(body.idempotencyKey || '')));
        return;
      }
      response.statusCode = 404;
      response.end('Not found');
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad request' });
    }
  };
  const server = options.tls
    ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert, ...(options.tls.ca && { ca: options.tls.ca }), requestCert: options.tls.requestCert ?? Boolean(options.tls.ca), rejectUnauthorized: options.tls.rejectUnauthorized ?? Boolean(options.tls.ca) }, handler)
    : createHttpServer(handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxConnections = Math.min(Math.max(Math.trunc(options.maxConnections ?? 256), 1), 2048);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, host, () => { server.off('error', reject); resolvePromise(); });
    });
  } catch (error) {
    await hub.close().catch(() => undefined);
    throw error;
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port || 0;
  return {
    server,
    host,
    port,
    hub,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
      await hub.close();
    },
  };
}
