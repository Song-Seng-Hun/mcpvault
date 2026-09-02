import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { getServerRuntime } from './createServer.js';
function sendJson(request, response, status, value, cacheable = false) {
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
    }
    else {
        response.setHeader('cache-control', 'no-store');
    }
    response.setHeader('content-length', Buffer.byteLength(body));
    response.end(body);
}
function tokenFrom(request) {
    const header = request.headers.authorization;
    return typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : undefined;
}
const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RATE_BUCKETS = 4_096;
const REGISTRATION_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REGISTRATIONS_PER_WINDOW = 5;
function requestHost(request) {
    const host = request.headers.host;
    if (!host)
        return undefined;
    try {
        return new URL(`http://${host}`).hostname.toLowerCase();
    }
    catch {
        return undefined;
    }
}
function originAllowed(request, allowedOrigins) {
    const origin = request.headers.origin;
    return typeof origin !== 'string' || allowedOrigins.includes(origin);
}
async function readBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxBytes)
            throw new Error(`request body exceeds ${maxBytes} bytes`);
        chunks.push(buffer);
    }
    if (chunks.length === 0)
        return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('request body must be a JSON object');
    return parsed;
}
function resultValue(result) {
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string')
        return result;
    try {
        return JSON.parse(text);
    }
    catch {
        return { message: text };
    }
}
/**
 * Start the optional HTTP adapter on the same service runtime as the MCP
 * server. The adapter is localhost-only by default and never starts unless a
 * host explicitly opts into it.
 */
export async function startRestApi(server, options = {}) {
    const runtime = getServerRuntime(server);
    if (!runtime)
        throw new Error('The supplied MCP server has no MCPVault runtime');
    runtime.ensureEndpointRegistry();
    const host = options.host || '127.0.0.1';
    const maxBodyBytes = Math.min(Math.max(Math.trunc(options.maxBodyBytes ?? 1_048_576), 1_024), MAX_HTTP_BODY_BYTES);
    const allowedOrigins = options.allowedOrigins || [];
    const allowedHosts = options.allowedHosts || (host === '127.0.0.1' ? ['127.0.0.1', 'localhost'] : [host]);
    const registrationWindows = new Map();
    const registrationAllowed = (key) => {
        const now = Date.now();
        const current = registrationWindows.get(key);
        if (!current || now - current.startedAt >= REGISTRATION_WINDOW_MS) {
            if (registrationWindows.size >= MAX_RATE_BUCKETS) {
                for (const [bucket, value] of registrationWindows) {
                    if (now - value.startedAt >= REGISTRATION_WINDOW_MS)
                        registrationWindows.delete(bucket);
                    if (registrationWindows.size < MAX_RATE_BUCKETS)
                        break;
                }
            }
            if (registrationWindows.size >= MAX_RATE_BUCKETS && !registrationWindows.has(key))
                return false;
            registrationWindows.set(key, { startedAt: now, count: 1 });
            return true;
        }
        if (current.count >= MAX_REGISTRATIONS_PER_WINDOW)
            return false;
        current.count += 1;
        return true;
    };
    const httpServer = createServer(async (request, response) => {
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
                });
                sendJson(request, response, result.isError ? 400 : 200, resultValue(result), !result.isError);
                return;
            }
            let body = {};
            if (request.method !== 'GET' && request.method !== 'HEAD')
                body = await readBody(request, maxBodyBytes);
            if (bearer && body.accessToken === undefined)
                body.accessToken = bearer;
            const genericPrefix = '/api/endpoint/';
            let endpointId;
            let pathArguments = {};
            if (requestUrl.pathname.startsWith(genericPrefix)) {
                endpointId = decodeURIComponent(requestUrl.pathname.slice(genericPrefix.length));
            }
            else {
                const match = runtime.endpointRegistry.resolveRoute(request.method || 'GET', requestUrl.pathname);
                endpointId = match?.endpoint.endpointId;
                pathArguments = match?.pathArguments || {};
            }
            if (!endpointId) {
                sendJson(request, response, 404, { error: 'unknown endpoint route' });
                return;
            }
            if (endpointId === 'auth.register' && !registrationAllowed(request.socket.remoteAddress || 'unknown')) {
                response.statusCode = 429;
                response.setHeader('retry-after', String(Math.ceil(REGISTRATION_WINDOW_MS / 1_000)));
                response.end('Registration rate limit exceeded; retry later');
                return;
            }
            const queryArguments = Object.fromEntries(requestUrl.searchParams.entries());
            const arguments_ = { ...queryArguments, ...pathArguments, ...body };
            const result = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: arguments_ });
            sendJson(request, response, result.isError ? 400 : 200, resultValue(result), !result.isError && request.method === 'GET');
        }
        catch (error) {
            sendJson(request, response, 400, { error: error instanceof Error ? error.message : 'Unknown error' });
        }
    });
    httpServer.requestTimeout = 30_000;
    httpServer.headersTimeout = 10_000;
    httpServer.keepAliveTimeout = 5_000;
    httpServer.maxHeadersCount = 64;
    httpServer.maxRequestsPerSocket = 100;
    httpServer.maxConnections = Math.min(Math.max(Math.trunc(options.maxConnections ?? 256), 1), 2_048);
    await new Promise((resolve, reject) => {
        const onError = (error) => { httpServer.off('listening', onListening); reject(error); };
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
        close: () => new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve())),
    };
}
