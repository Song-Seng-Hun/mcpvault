import { guidanceError } from './guidance-runtime.js';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import type { Server } from '@modelcontextprotocol/server';
import { getServerRuntime } from './createServer.js';
import { configureHttpServer, createRateLimiter, isLoopbackHost, MAX_HTTP_BODY_BYTES, originAllowed, readRequestBody, requestHost } from './http-request-utils.js';

export interface RestApiOptions {
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  maxConnections?: number;
  tls?: {
    key: string;
    cert: string;
    ca?: string;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
  };
}

export interface RestApiHandle {
  server: HttpServer | HttpsServer;
  host: string;
  port: number;
  close(): Promise<void>;
}

function sendJson(request: IncomingMessage, response: ServerResponse, status: number, value: unknown, cacheable = false): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (cacheable && status >= 200 && status < 300) {
    const etag = `"${createHash('sha256').update(body, 'utf8').digest('hex')}"`;
    response.setHeader('etag', etag);
    response.setHeader('cache-control', 'private, max-age=2, must-revalidate');
    response.setHeader('vary', 'Authorization');
    const requestedTag = request.headers['if-none-match'];
    if (typeof requestedTag === 'string' && requestedTag.split(',').map(tag => tag.trim()).includes(etag)) {
      response.statusCode = 304;
      response.removeHeader('content-type');
      response.setHeader('content-length', '0');
      response.end();
      return;
    }
  } else {
    response.setHeader('cache-control', 'no-store');
  }
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

function tokenFrom(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  return typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : undefined;
}

const MAX_RATE_BUCKETS = 4_096;
const REGISTRATION_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REGISTRATIONS_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60 * 1_000;
const MAX_LOGINS_PER_WINDOW = 120;

function resultValue(result: any): unknown {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return result;
  try { return JSON.parse(text); } catch { return { message: text }; }
}

/**
 * Start the optional HTTP adapter on the same service runtime as the MCP
 * server. The adapter is localhost-only by default and never starts unless a
 * host explicitly opts into it.
 */
export async function startRestApi(server: Server, options: RestApiOptions = {}): Promise<RestApiHandle> {
  const runtime = getServerRuntime(server);
  if (!runtime) throw guidanceError(new Error('The supplied MCP server has no MCPVault runtime'), 'guid-f9ffb2364fcd3a70');
  runtime.ensureEndpointRegistry();
  const host = options.host || '127.0.0.1';
  if (!isLoopbackHost(host) && !options.tls) {
    throw guidanceError(new Error('REST adapter requires TLS when binding to a non-loopback host'), 'guid-ee781a25887cab92');
  }
  const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? 1_048_576), 1_024), MAX_HTTP_BODY_BYTES);
  const allowedOrigins = options.allowedOrigins || [];
  const allowedHosts = options.allowedHosts || (host === '127.0.0.1' ? ['127.0.0.1', 'localhost'] : [host]);
  const registrationAllowed = createRateLimiter(REGISTRATION_WINDOW_MS, MAX_REGISTRATIONS_PER_WINDOW, MAX_RATE_BUCKETS);
  const loginAllowed = createRateLimiter(LOGIN_WINDOW_MS, MAX_LOGINS_PER_WINDOW, MAX_RATE_BUCKETS);

  const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${host}`);
      if (!originAllowed(request, allowedOrigins)) {
        response.statusCode = 403;
        response.end('Forbidden origin');
        return;
      }
      if (!allowedHosts.includes(requestHost(request) || '')) {
        response.statusCode = 400;
        response.end('Invalid host');
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
        sendJson(request, response, 200, { ok: true });
        return;
      }

      const bearer = tokenFrom(request);
      if (request.method === 'GET' && requestUrl.pathname === '/api/capabilities') {
        const result = await runtime.dispatchTool('list_active_capabilities', {
          ...(bearer && { accessToken: bearer }),
          limit: requestUrl.searchParams.get('limit') || undefined,
          maxChars: requestUrl.searchParams.get('maxChars') || undefined,
          cursor: requestUrl.searchParams.get('cursor') ?? undefined,
        });
        sendJson(request, response, result.isError ? 400 : 200, resultValue(result), !result.isError);
        return;
      }

      let body: Record<string, unknown> = {};
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const rawBody = await readRequestBody(request, maxBodyBytes);
        if (rawBody) {
          const parsed: unknown = JSON.parse(rawBody);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw guidanceError(new Error('request body must be a JSON object'), 'guid-cb8f7c49eade4be2');
          body = parsed as Record<string, unknown>;
        }
      }
      if (bearer && body.accessToken === undefined) body.accessToken = bearer;

      const genericPrefix = '/api/endpoint/';
      let endpointId: string | undefined;
      let pathArguments: Record<string, string> = {};
      if (requestUrl.pathname === '/api/evolution/context') {
        endpointId = 'evolution.context';
      } else if (requestUrl.pathname.startsWith(genericPrefix)) {
        endpointId = decodeURIComponent(requestUrl.pathname.slice(genericPrefix.length));
      } else {
        const match = runtime.endpointRegistry.resolveRoute(request.method || 'GET', requestUrl.pathname);
        endpointId = match?.endpoint.endpointId;
        pathArguments = match?.pathArguments || {};
      }
      if (!endpointId) {
        sendJson(request, response, 404, { error: 'unknown endpoint route' });
        return;
      }
      const endpoint = runtime.endpointRegistry.resolve(endpointId);
      if (!endpoint) {
        sendJson(request, response, 404, { error: 'unknown endpoint route' });
        return;
      }
      const contextOp = body.op ?? requestUrl.searchParams.get('op') ?? 'read';
      const contextMethod = endpointId === 'evolution.context' ? (contextOp === 'begin' ? 'POST' : 'GET') : undefined;
      if ((request.method || 'GET').toUpperCase() !== (contextMethod ?? endpoint.method)) {
        response.setHeader('allow', contextMethod ?? endpoint.method);
        sendJson(request, response, 405, { error: 'method not allowed', endpointId, expectedMethod: contextMethod ?? endpoint.method });
        return;
      }
      if (endpointId === 'auth.register' && !registrationAllowed(request.socket.remoteAddress || 'unknown')) {
        response.statusCode = 429;
        response.setHeader('retry-after', String(Math.ceil(REGISTRATION_WINDOW_MS / 1_000)));
        response.end('Registration rate limit exceeded; retry later');
        return;
      }
      if (endpointId === 'auth.login' && !loginAllowed(request.socket.remoteAddress || 'unknown')) {
        response.statusCode = 429;
        response.setHeader('retry-after', String(Math.ceil(LOGIN_WINDOW_MS / 1_000)));
        response.end('Login rate limit exceeded; retry later');
        return;
      }

      const { $view: responseView, $cursor: responseCursor, ...queryArguments } = Object.fromEntries(requestUrl.searchParams.entries());
      if (endpointId === 'evolution.context') {
        for (const key of ['maxChars', 'offset']) if (/^\d{1,5}$/.test(queryArguments[key] ?? '')) (queryArguments as Record<string, unknown>)[key] = Number(queryArguments[key]);
      }
      // The topic service validates numbers strictly. URL query parameters
      // arrive as strings; normalize only this new endpoint's typed inputs.
      if (endpointId === 'wiki.topic_packet') {
        for (const key of ['limit', 'maxChars']) {
          if (typeof queryArguments[key] === 'string' && /^\d+$/.test(queryArguments[key]!)) {
            (queryArguments as Record<string, unknown>)[key] = Number(queryArguments[key]);
          }
        }
        if (queryArguments.prettyPrint === 'true' || queryArguments.prettyPrint === 'false') {
          (queryArguments as Record<string, unknown>).prettyPrint = queryArguments.prettyPrint === 'true';
        }
      }
      const arguments_ = { ...queryArguments, ...pathArguments, ...body };
      const result = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: arguments_, responseView, responseCursor });
      sendJson(request, response, result.isError ? 400 : 200, resultValue(result), !result.isError && request.method === 'GET');
    } catch (error) {
      sendJson(request, response, 400, { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  };
  const httpServer = options.tls
    ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert, ...(options.tls.ca && { ca: options.tls.ca }), requestCert: options.tls.requestCert ?? Boolean(options.tls.ca), rejectUnauthorized: options.tls.rejectUnauthorized ?? Boolean(options.tls.ca) }, requestHandler)
    : createHttpServer(requestHandler);
  configureHttpServer(httpServer, options.maxConnections);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { httpServer.off('listening', onListening); reject(error); };
    const onListening = () => { httpServer.off('error', onError); resolve(); };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(options.port ?? 0, host);
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port || 0;
  return {
    server: httpServer,
    host,
    port,
    close: () => new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve())),
  };
}
