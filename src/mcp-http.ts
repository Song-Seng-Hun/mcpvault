import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createMcpHandler, type Server } from '@modelcontextprotocol/server';
import { getServerRuntime } from './createServer.js';

export interface McpHttpOptions {
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  allowedOrigins?: string[];
  allowedHosts?: string[];
}

export interface McpHttpHandle {
  server: HttpServer;
  host: string;
  port: number;
  path: string;
  close(): Promise<void>;
}

function headerValues(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function requestHost(request: IncomingMessage): string | undefined {
  const host = request.headers.host;
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function originAllowed(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin;
  return typeof origin !== 'string' || allowedOrigins.includes(origin);
}

function writeResponse(response: ServerResponse, webResponse: Response): void {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => response.setHeader(key, value));

  if (!webResponse.body) {
    response.end();
    return;
  }

  const reader = webResponse.body.getReader();
  void (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (response.destroyed) break;
        response.write(Buffer.from(chunk.value));
      }
    } finally {
      response.end();
    }
  })();
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
  if (!runtime) throw new Error('The supplied MCP server has no MCPVault runtime');

  const host = options.host || '127.0.0.1';
  const path = options.path || '/mcp';
  const maxBodyBytes = options.maxBodyBytes || 1_048_576;
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

  const httpServer = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || host}`);
      addCorsHeaders(response, request, allowedOrigins);

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

      const rawBody = request.method === 'GET' || request.method === 'HEAD' ? '' : await readBody(request, maxBodyBytes);
      let body = rawBody;
      const bearerHeader = request.headers.authorization;
      const bearer = typeof bearerHeader === 'string' && /^Bearer\s+/i.test(bearerHeader)
        ? bearerHeader.replace(/^Bearer\s+/i, '').trim()
        : undefined;
      if (bearer && rawBody) {
        body = JSON.stringify(injectBearer(JSON.parse(rawBody), bearer));
      }

      const headers = headerValues(request);
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
      const webResponse = await mcpHandler.fetch(webRequest);
      writeResponse(response, webResponse);
    } catch (error) {
      addCorsHeaders(response, request, allowedOrigins);
      response.statusCode = 400;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
    }
  });

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
    close: async () => {
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    },
  };
}
