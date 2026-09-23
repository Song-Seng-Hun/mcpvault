import { guidanceError } from './guidance-runtime.js';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TLSSocket } from 'node:tls';
import { createMcpHandler, type Server } from '@modelcontextprotocol/server';
import { getServerRuntime } from './createServer.js';
import { withEnterpriseRequestContext } from './enterprise-request-context.js';
import { allowedReviewedSkillRequest } from './skill-release-http-policy.js';
import { configureHttpServer, createRateLimiter, isLoopbackHost, MAX_HTTP_BODY_BYTES, originAllowed, readRequestBody, requestHost } from './http-request-utils.js';
import type { Auth0Resource } from './auth0-resource.js';

export interface McpHttpOptions {
  /** Explicit host-configured OAuth resource; legacy HTTP remains unchanged when absent. */
  auth0?: Auth0Resource;
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  maxConnections?: number;
  /** Require a CA-verified client certificate for every MCP request. */
  requireClientCertificate?: boolean;
  /** Host-only supplementary read channel; absent preserves normal MCP behavior. */
  requestProfile?: 'reviewed-skill-read';
  /** Host config only; keeps the existing supplementary read profile closed by default. */
  allowProcedureDiscovery?: boolean;
  tls?: {
    key: string | Buffer;
    cert: string | Buffer;
    ca?: string | Buffer;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
  };
}

export interface McpHttpHandle {
  server: HttpServer | HttpsServer;
  host: string;
  port: number;
  path: string;
  protocol: 'http' | 'https';
  close(): Promise<void>;
}

function headerValues(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const MAX_RATE_BUCKETS = 4_096;
const REGISTRATION_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REGISTRATIONS_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60 * 1_000;
const MAX_LOGINS_PER_WINDOW = 120;

/**
 * LAN mode must be addressed to a concrete private interface. Wildcard and
 * public binds are intentionally rejected so a typo cannot publish MCP over
 * every interface or the public Internet.
 */
function isPrivateLanHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(normalized)) return true;
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return first === 10
      || (first === 172 && second !== undefined && second >= 16 && second <= 31)
      || (first === 192 && second === 168);
  }
  if (family === 6) {
    return normalized.startsWith('fc') || normalized.startsWith('fd');
  }
  return false;
}

function isRegistrationCall(value: unknown): boolean {
  const requests = Array.isArray(value) ? value : [value];
  return requests.some(request => {
    if (!isRecord(request) || request.method !== 'tools/call' || !isRecord(request.params)) return false;
    const params = request.params;
    if (params.name !== 'call_endpoint' || !isRecord(params.arguments)) return false;
    return params.arguments.endpointId === 'auth.register';
  });
}

/**
 * Codex sends bearer credentials in the HTTP envelope while MCPVault's
 * dispatcher intentionally keeps the principal token in tool arguments. Move
 * only the bearer credential into a tools/call request; the MCP protocol body
 * remains unchanged for every other method.
 */
function injectBearer(body: unknown, bearer: string | undefined): unknown {
  if (!bearer) return body;
  if (Array.isArray(body)) return body.map(item => injectBearer(item, bearer));
  if (!isRecord(body) || body.method !== 'tools/call') return body;

  const params = isRecord(body.params) ? body.params : {};
  const arguments_ = isRecord(params.arguments) ? params.arguments : {};
  return {
    ...body,
    params: {
      ...params,
      arguments: { ...arguments_, accessToken: bearer },
    },
  };
}

function forbiddenOAuthCall(body: unknown): boolean {
  const identityEndpoints = new Set([
    'mcp.create_agent_scope', 'mcp.handoff_agent_scope', 'mcp.resume_agent_scope', 'mcp.update_agent_capabilities',
  ]);
  const requests = Array.isArray(body) ? body : [body];
  return requests.some(item => {
    if (!isRecord(item) || item.method !== 'tools/call' || !isRecord(item.params)) return false;
    const params = item.params;
    if (!isRecord(params.arguments)) return false;
    const args = params.arguments;
    if (Object.hasOwn(args, 'accessToken')) return true;
    if (params.name !== 'call_endpoint') return false;
    if (isRecord(args.arguments) && Object.hasOwn(args.arguments, 'accessToken')) return true;
    const endpoint = args.endpointId;
    return typeof endpoint === 'string' && (
      (endpoint.startsWith('auth.') && endpoint !== 'auth.whoami') || identityEndpoints.has(endpoint)
    );
  });
}

function reportedOAuthLabel(body: unknown, allowed: readonly string[]): string | undefined {
  const requests = Array.isArray(body) ? body : [body];
  const labels = new Set<string>();
  for (const item of requests) {
    if (!isRecord(item) || item.method !== 'tools/call' || !isRecord(item.params) || !isRecord(item.params.arguments)) continue;
    const args = item.params.arguments;
    if (!Object.hasOwn(args, 'agentLabel')) continue;
    if (typeof args.agentLabel !== 'string' || !allowed.includes(args.agentLabel)) throw new Error('Unapproved agent label');
    labels.add(args.agentLabel);
  }
  if (labels.size > 1) throw new Error('Conflicting agent labels');
  return labels.values().next().value;
}

/**
 * A client certificate is trusted only after Node's TLS verifier accepts the
 * peer. Headers and JSON bodies are deliberately excluded from this boundary.
 */
function trustedPeerFingerprint(request: IncomingMessage): string | undefined {
  const socket = request.socket as TLSSocket;
  if (!socket.encrypted || socket.authorized !== true) return undefined;
  const fingerprint = socket.getPeerCertificate().fingerprint256;
  const normalized = typeof fingerprint === 'string' ? fingerprint.replaceAll(':', '').toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

async function writeResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => response.setHeader(key, value));

  if (!webResponse.body) {
    response.end();
    return;
  }

  // Couple upstream reads to socket backpressure. Pipeline also cancels the
  // Web producer on disconnect and rejects stream failures to our caller.
  await pipeline(Readable.fromWeb(webResponse.body), response);
}

function addCorsHeaders(response: ServerResponse, request: IncomingMessage, allowedOrigins: readonly string[]): void {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
    response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    response.setHeader('vary', 'Origin');
  }
}

/**
 * Expose MCP 2026-07-28 Stateless Streamable HTTP. The long-lived MCPVault
 * runtime stays behind the adapter; createMcpHandler receives a fresh low-level
 * Server for every HTTP request, preventing transport/server state from being
 * shared across clients.
 */
export async function startMcpHttpApi(server: Server, options: McpHttpOptions = {}): Promise<McpHttpHandle> {
  const runtime = getServerRuntime(server);
  if (!runtime) throw guidanceError(new Error('The supplied MCP server has no MCPVault runtime'), 'guid-f9ffb2364fcd3a70');

  const host = options.host || '127.0.0.1';
  if (!isPrivateLanHost(host)) {
    throw guidanceError(new Error('Stateless MCP HTTP may bind only to localhost or a concrete private LAN address'), 'guid-6da5c4e4055efe78');
  }
  if (!isLoopbackHost(host) && !options.tls) {
    throw guidanceError(new Error('Stateless MCP HTTP requires TLS when binding to a non-loopback host'), 'guid-d2588f6b956bf72d');
  }
  if (options.requireClientCertificate && (!options.tls || options.tls.ca === undefined)) {
    throw guidanceError(new Error('mTLS required mode requires TLS with a CA'), 'guid-85a675d6f739522a');
  }
  if(options.requestProfile!==undefined&&(options.requestProfile!=='reviewed-skill-read'||!isLoopbackHost(host)||!options.requireClientCertificate)){
    throw new Error('Reviewed skill HTTP profile requires loopback and mandatory mTLS');
  }
  if (options.auth0 && (!isLoopbackHost(host) || options.requestProfile || options.requireClientCertificate)) {
    throw new Error('Auth0 MCP HTTP requires its own loopback listener');
  }
  if(options.allowProcedureDiscovery!==undefined&&(typeof options.allowProcedureDiscovery!=='boolean'||options.requestProfile!=='reviewed-skill-read')){
    throw new Error('Procedure discovery requires the reviewed-skill HTTP profile');
  }
  // Freeze host choice at startup; a later mutation of the options object is not approval.
  const allowProcedureDiscovery=options.allowProcedureDiscovery===true;
  const path = options.path || '/mcp';
  const protectedResourceMetadataPath = `/.well-known/oauth-protected-resource${path === '/' ? '' : path}`;
  const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? 1_048_576), 1_024), MAX_HTTP_BODY_BYTES);
  const allowedOrigins = options.allowedOrigins || [];
  const allowedHosts = options.allowedHosts || (host === '127.0.0.1' ? ['127.0.0.1', 'localhost'] : [host]);
  const mcpHandler = createMcpHandler(
    () => runtime.createRequestServer(),
    {
      legacy: 'stateless',
      responseMode: 'auto',
      onerror: error => console.error(error),
    },
  );
  const registrationAllowed = createRateLimiter(REGISTRATION_WINDOW_MS, MAX_REGISTRATIONS_PER_WINDOW, MAX_RATE_BUCKETS);
  const loginAllowed = createRateLimiter(LOGIN_WINDOW_MS, MAX_LOGINS_PER_WINDOW, MAX_RATE_BUCKETS);

  const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
    let researchSession: Awaited<ReturnType<NonNullable<typeof runtime.issueTrustedResearchSession>>> | undefined;
    let researchAuthorization: Awaited<ReturnType<Auth0Resource['verifyAccessToken']>> | undefined;
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || host}`);
      if (requestUrl.pathname === '/evolution/review' && runtime.evolutionReview && isLoopbackHost(host) && !options.auth0
        && !options.requireClientCertificate && !options.requestProfile) {
        await runtime.evolutionReview.handle(request, response); return;
      }
      addCorsHeaders(response, request, allowedOrigins);

      if (options.auth0 && (requestUrl.pathname === '/.well-known/oauth-protected-resource'
        || requestUrl.pathname === protectedResourceMetadataPath)) {
        if (!originAllowed(request, allowedOrigins) || !allowedHosts.includes(requestHost(request) || '')) {
          response.statusCode = 403; response.end('Forbidden'); return;
        }
        if (request.method !== 'GET') { response.statusCode = 405; response.end('Method not allowed'); return; }
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'public, max-age=300');
        response.end(JSON.stringify(options.auth0.metadata()));
        return;
      }

      if (requestUrl.pathname !== path) {
        response.statusCode = 404;
        response.end('Not found');
        return;
      }

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

      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.end();
        return;
      }

      const certFingerprint = trustedPeerFingerprint(request);
      if (options.requireClientCertificate && !certFingerprint) {
        response.statusCode = 403;
        response.end('Client certificate required');
        return;
      }

      const rawBody = request.method === 'GET' || request.method === 'HEAD' ? '' : await readRequestBody(request, maxBodyBytes);
      if(options.requestProfile==='reviewed-skill-read'){
        let candidate:unknown;
        try{candidate=JSON.parse(rawBody);}catch{/* Reject without echoing the payload. */}
        if(!allowedReviewedSkillRequest(request.method,candidate,allowProcedureDiscovery)){
          response.statusCode=403;
          response.end('Request unavailable on reviewed-skill read channel');
          return;
        }
      }
      let body = rawBody;
      const bearerHeader = request.headers.authorization;
      const bearer = typeof bearerHeader === 'string' && /^Bearer\s+/i.test(bearerHeader)
        ? bearerHeader.replace(/^Bearer\s+/i, '').trim()
        : undefined;
      if (options.auth0) {
        const resourceUrl = new URL(options.auth0.config.resource);
        const metadataUrl = new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname === '/' ? '' : resourceUrl.pathname}`, resourceUrl).href;
        // tunnel-client probes with an empty JSON POST. Its own discovery must
        // fetch the local metadata, not the connector-only public gateway URL.
        const localDiscoveryProbe = request.method === 'POST' && !rawBody
          && request.headers.accept === 'application/json'
          && request.headers['user-agent']?.startsWith('oai-tunnel-client/');
        const challengeMetadataUrl = localDiscoveryProbe
          ? new URL(protectedResourceMetadataPath, `${options.tls ? 'https' : 'http'}://${request.headers.host}`).href
          : metadataUrl;
        const challenge = () => {
          response.statusCode = 401;
          response.setHeader('www-authenticate', `Bearer resource_metadata="${challengeMetadataUrl}", scope="${options.auth0!.config.scope}"`);
          response.setHeader('cache-control', 'no-store');
          response.end('Unauthorized');
        };
        if (!bearer) { challenge(); return; }
        try { researchAuthorization = await options.auth0.verifyAccessToken(bearer); }
        catch { challenge(); return; }
        let parsed: unknown;
        let reportedAgentLabel: string | undefined;
        if (rawBody) {
          try {
            parsed = JSON.parse(rawBody);
            if (forbiddenOAuthCall(parsed)) { response.statusCode = 403; response.end('Credential operation unavailable'); return; }
            reportedAgentLabel = reportedOAuthLabel(parsed, options.auth0.config.allowedAgentLabels);
          } catch {
            response.statusCode = 403; response.end('Invalid OAuth MCP request'); return;
          }
        }
        if (!runtime.issueTrustedResearchSession) { response.statusCode = 503; response.end('Research account unavailable'); return; }
        try { researchSession = await runtime.issueTrustedResearchSession(researchAuthorization.accountId, reportedAgentLabel); }
        catch { response.statusCode = 503; response.end('Research account unavailable'); return; }
        if (rawBody) {
          body = JSON.stringify(injectBearer(parsed, researchSession.accessToken));
        }
      }
      if (!options.auth0 && rawBody) {
        const parsedBody: unknown = JSON.parse(rawBody);
        if (isRegistrationCall(parsedBody) && !registrationAllowed(request.socket.remoteAddress || 'unknown')) {
          response.statusCode = 429;
          response.setHeader('retry-after', String(Math.ceil(REGISTRATION_WINDOW_MS / 1_000)));
          response.end('Registration rate limit exceeded; retry later');
          return;
        }
        const requests = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
        const isLogin = requests.some(item => {
          if (!isRecord(item) || item.method !== 'tools/call' || !isRecord(item.params)) return false;
          const params = item.params;
          if (params.name !== 'call_endpoint' || !isRecord(params.arguments)) return false;
          return params.arguments.endpointId === 'auth.login';
        });
        if (isLogin && !loginAllowed(request.socket.remoteAddress || 'unknown')) {
          response.statusCode = 429;
          response.setHeader('retry-after', String(Math.ceil(LOGIN_WINDOW_MS / 1_000)));
          response.end('Login rate limit exceeded; retry later');
          return;
        }
      }
      if (!options.auth0 && bearer && rawBody) {
        body = JSON.stringify(injectBearer(JSON.parse(rawBody), bearer));
      }

      const headers = headerValues(request);
      // The external JWT is verified only at this boundary. The MCP handler
      // receives a short-lived internal session in the tool body, never JWTs.
      if (options.auth0) headers.delete('authorization');
      if (body !== rawBody) {
        // The Authorization header was folded into the JSON-RPC body, so the
        // original byte count no longer describes the Request we construct.
        headers.delete('content-length');
        headers.delete('transfer-encoding');
      }
      const webRequest = new Request(requestUrl, {
        method: request.method || 'GET',
        headers,
        ...(body && request.method !== 'GET' && request.method !== 'HEAD' ? { body } : {}),
      });
      const dispatch = async () => {
        const webResponse = await withEnterpriseRequestContext(
          { transport: 'http', ...(certFingerprint ? { certFingerprint } : {}) },
          () => mcpHandler.fetch(webRequest),
        );
        await writeResponse(response, webResponse);
      };
      if (options.auth0 && researchAuthorization && researchSession) {
        await options.auth0.withResearchSession(researchAuthorization, researchSession.principal, dispatch);
      }
      else await dispatch();
    } catch (error) {
      // A failed stream is incomplete, not a successful truncated result or a
      // second JSON response appended after headers/body have already gone out.
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      addCorsHeaders(response, request, allowedOrigins);
      response.statusCode = 400;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: options.auth0 ? 'Invalid MCP request' : error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      researchSession?.revoke();
    }
  };
  const httpServer = options.tls
    ? createHttpsServer({
        key: options.tls.key,
        cert: options.tls.cert,
        ...(options.tls.ca !== undefined ? { ca: options.tls.ca } : {}),
        requestCert: options.requireClientCertificate ? true : options.tls.requestCert ?? Boolean(options.tls.ca),
        rejectUnauthorized: options.requireClientCertificate ? true : options.tls.rejectUnauthorized ?? Boolean(options.tls.ca),
      }, requestHandler)
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
    path,
    protocol: options.tls ? 'https' : 'http',
    close: async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    },
  };
}
