import { afterEach, expect, test, vi } from 'vitest';
import { Agent, get, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Server } from '@modelcontextprotocol/server';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';

// Substitute only the SDK producer: exercise the actual HTTP adapter, Node
// sockets, Web streams, and writable buffering without a live Vault/account.
const producer = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@modelcontextprotocol/server', () => ({
  createMcpHandler: () => ({ fetch: producer.fetch, close: async () => {} }),
}));
vi.mock('./createServer.js', () => ({
  getServerRuntime: () => ({ createRequestServer: () => ({}) }),
}));

const apis: McpHttpHandle[] = [];
const clients: ClientRequest[] = [];
const agents: Agent[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  for (const agent of agents.splice(0)) agent.destroy();
  for (const api of apis.splice(0)) {
    api.server.closeAllConnections();
    await api.close();
  }
  producer.fetch.mockReset();
});

async function serve(webResponse: Response) {
  producer.fetch.mockResolvedValue(webResponse);
  const api = await startMcpHttpApi({} as Server, { port: 0 });
  apis.push(api);
  return api;
}

function connect(api: McpHttpHandle, agent?: Agent): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = get(`http://127.0.0.1:${api.port}/mcp`, { agent: agent ?? false }, resolve);
    clients.push(client);
    client.on('error', reject);
  });
}

test('a paused client does not cause the entire upstream response to be buffered', async () => {
  const chunk = new Uint8Array(64 * 1024);
  const totalChunks = 512;
  let produced = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced === totalChunks) controller.close();
      else { produced++; controller.enqueue(chunk); }
    },
  });
  const api = await serve(new Response(body));
  let response: ServerResponse | undefined;
  api.server.on('request', (_request, outgoing) => { response = outgoing; });
  const client = await connect(api);
  client.pause();
  for (let i = 0; i < 5; i++) await nextTurn();
  expect(produced).toBeGreaterThan(0);
  expect(produced).toBeLessThan(totalChunks);
  // The bridge may hold a chunk beyond its watermark, never the whole body.
  expect(response!.writableLength).toBeLessThanOrEqual(2 * chunk.byteLength);
  let previous = produced;
  let stableSamples = 0;
  await expect.poll(() => {
    stableSamples = produced === previous && response!.writableNeedDrain ? stableSamples + 1 : 0;
    previous = produced;
    return stableSamples;
  }, { interval: 20, timeout: 2000 }).toBeGreaterThanOrEqual(3);
  expect(produced).toBeLessThan(totalChunks);
  let bytes = 0;
  for await (const value of client) bytes += value.byteLength;
  expect(bytes).toBe(totalChunks * chunk.byteLength);
  expect(produced).toBe(totalChunks);
  expect(client.complete).toBe(true);
});

test('disconnect cancels an upstream stream even while its next read is pending', async () => {
  let cancelled = false;
  let awaitingNextRead = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('hello')); },
    pull() { awaitingNextRead = true; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const api = await serve(new Response(body));
  const client = await connect(api);
  await expect.poll(() => awaitingNextRead, { timeout: 1000 }).toBe(true);
  client.destroy();
  await expect.poll(() => cancelled, { timeout: 1000 }).toBe(true);
});

test('a producer error after headers aborts the response and leaves the server usable', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; value.enqueue(new TextEncoder().encode('partial')); },
  });
  const api = await serve(new Response(body));
  const client = await connect(api);
  const closed = new Promise<void>(resolve => {
    client.on('error', () => {});
    client.once('close', resolve);
  });
  client.resume();
  controller.error(new Error('synthetic producer error'));
  await closed;
  expect(client.complete).toBe(false);
  producer.fetch.mockResolvedValue(new Response('still healthy'));
  const next = await connect(api);
  let text = '';
  for await (const chunk of next) text += chunk.toString();
  expect(text).toBe('still healthy');
});

test('resuming a slow client preserves every byte, status, and response header', async () => {
  const chunks = Array.from({ length: 64 }, (_, i) => Buffer.from(`한국어-${i}-` + 'x'.repeat(8192)));
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close();
      else controller.enqueue(chunks[index++]!);
    },
  });
  const api = await serve(new Response(body, { status: 201, headers: { 'x-stream-test': 'preserved' } }));
  const client = await connect(api);
  client.pause();
  await nextTurn();
  const received: Buffer[] = [];
  for await (const chunk of client) received.push(chunk);
  expect(client.statusCode).toBe(201);
  expect(client.headers['x-stream-test']).toBe('preserved');
  expect(Buffer.concat(received)).toEqual(Buffer.concat(chunks));
  expect(client.complete).toBe(true);
});

test('bodyless responses complete without creating a stream', async () => {
  const api = await serve(new Response(null, { status: 204, headers: { 'x-stream-test': 'empty' } }));
  const client = await connect(api);
  let bytes = 0;
  for await (const chunk of client) bytes += chunk.length;
  expect(bytes).toBe(0);
  expect(client.statusCode).toBe(204);
  expect(client.headers['x-stream-test']).toBe('empty');
});

test('a late SDK response is cancelled when the HTTP client has already left', async () => {
  const api = await serve(new Response('unused'));
  let resolveResponse!: (response: Response) => void;
  let markRequest!: () => void;
  const requested = new Promise<void>(resolve => { markRequest = resolve; });
  producer.fetch.mockImplementation(() => {
    markRequest();
    return new Promise<Response>(resolve => { resolveResponse = resolve; });
  });
  let markClosed!: () => void;
  const closed = new Promise<void>(resolve => { markClosed = resolve; });
  api.server.once('request', (_request, response) => { response.once('close', markClosed); });
  const client = get(`http://127.0.0.1:${api.port}/mcp`, { agent: false });
  clients.push(client);
  client.on('error', () => {});
  await requested;
  client.destroy();
  await closed;
  let cancelled = false;
  resolveResponse(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  await expect.poll(() => cancelled, { timeout: 1000 }).toBe(true);
});

test('a stream error before any bytes terminates just that connection', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.error(new Error('synthetic early stream failure')); },
  });
  const api = await serve(new Response(body));
  await expect(connect(api)).rejects.toThrow();
  producer.fetch.mockResolvedValue(new Response('healthy after early error'));
  const client = await connect(api);
  let text = '';
  for await (const chunk of client) text += chunk.toString();
  expect(text).toBe('healthy after early error');
});

test('successful streamed responses reuse the same keep-alive connection', async () => {
  const api = await serve(new Response('first'));
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  agents.push(agent);
  const ports: Array<number | undefined> = [];
  api.server.on('request', request => { ports.push(request.socket.remotePort); });
  for (const expected of ['first', 'second']) {
    producer.fetch.mockResolvedValue(new Response(expected));
    const client = await connect(api, agent);
    let text = '';
    for await (const chunk of client) text += chunk.toString();
    expect(text).toBe(expected);
    expect(client.complete).toBe(true);
  }
  expect(ports).toHaveLength(2);
  expect(ports[0]).toBeTypeOf('number');
  expect(ports[1]).toBe(ports[0]);
});
