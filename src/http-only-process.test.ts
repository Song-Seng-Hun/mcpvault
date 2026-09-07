import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
async function withProcess(args: string[], run: (fixture: {
  child: ReturnType<typeof spawn>;
  stdout: () => string;
  stderr: () => string;
  waitUntil: (predicate: () => boolean) => Promise<void>;
}) => Promise<void>, observeLifecycle = false) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-http-only-';
  const vault = await mkdtemp(join(base, prefix));
  await writeFile(join(vault, 'Probe.md'), '# Probe\nSharedHttpProbe');
  const preload = join(vault, 'observe-lifecycle.mjs');
  if (observeLifecycle) await writeFile(preload, `
import { Server } from ${JSON.stringify(pathToFileURL(join(repo, 'node_modules/@modelcontextprotocol/server/dist/index.mjs')).href)};
import { getServerRuntime } from ${JSON.stringify(pathToFileURL(join(repo, 'dist/src/createServer.js')).href)};
const close = Server.prototype.close;
Server.prototype.close = async function () {
  const isRoot = Boolean(getServerRuntime(this));
  await close.call(this);
  if (isRoot) process.stderr.write('FIXTURE_ROOT_CLOSED\\n');
};
process.on('message', message => {
  if (message === 'signal') process.emit('SIGTERM');
  if (message === 'stdout-fault') process.stdout.emit('error', Object.assign(new Error('fixture stdout failure'), { code: 'EPIPE' }));
});
`);
  const env = { ...process.env };
  // Do not inherit operator HTTP/TLS settings in an isolated loopback fixture.
  for (const key of Object.keys(env)) if (key.startsWith('MCPVAULT_')) delete env[key];
  delete env.VITEST;
  const child = spawn(process.execPath, [...(observeLifecycle ? ['--import', pathToFileURL(preload).href] : []), join(repo, 'dist/server.js'), vault, ...args], {
    cwd: repo, env, stdio: observeLifecycle ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '', closed = false;
  const done = new Promise<void>(resolve => child.once('close', () => { closed = true; resolve(); }));
  child.stdout!.on('data', chunk => { stdout = (stdout + chunk).slice(-8192); });
  child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.stdin!.on('error', () => {}); // An already-exited fixture can reject EOF.
  const waitUntil = async (predicate: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
      if (closed || Date.now() >= deadline) throw new Error(`Fixture condition not met: ${stderr.slice(-1200)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try { await run({ child, stdout: () => stdout, stderr: () => stderr, waitUntil }); }
  finally {
    if (!closed) child.kill('SIGKILL'); // Only the child created immediately above.
    await done;
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('published HTTP-only entry point ignores stdin and serves two clients through detach and EOF', async () => {
  await withProcess(['--mcp-http-only=0'], async ({ child, stdout, stderr, waitUntil }) => {
    await waitUntil(() => /listening on http:\/\/127\.0\.0\.1:\d+\/mcp/.test(stderr()));
    const url = stderr().match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)![0];
    const clients: Client[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const client = new Client({ name: `shared-process-${i}`, version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      }
      child.stdin!.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ignored-stdio', version: '1.0.0' },
      } }) + '\n');
      await clients[0].close();
      const search = await clients[1].callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.search', arguments: {
        query: 'SharedHttpProbe', semantic: false, limit: 1, maxChars: 2000,
      } } });
      expect(search.isError).toBeFalsy();
      expect(JSON.stringify(search.content)).toContain('Probe.md');
      expect((await clients[1].listTools()).tools).toHaveLength(5);
      expect(stdout()).toBe('');
      expect(child.exitCode).toBeNull();
    } finally { for (const client of clients) await client.close(); }
  });
}, 15000);

test('failed HTTP startup exits nonzero after acquiring a REST listener', async () => {
  const occupied = createNetServer();
  await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const port = (occupied.address() as { port: number }).port;
  try {
    await withProcess(['--http=0', `--mcp-http-only=${port}`], async ({ child, stderr, waitUntil }) => {
      await waitUntil(() => child.exitCode !== null);
      expect(child.exitCode).not.toBe(0);
      expect(stderr()).toContain('REST adapter listening');
      expect(stderr()).toContain('EADDRINUSE');
      expect(stderr().match(/FIXTURE_ROOT_CLOSED/g)).toHaveLength(1);
    }, true);
  } finally { await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve())); }
}, 15000);

test('HTTP-only signal handler finishes actual root cleanup before exit', async () => {
  await withProcess(['--mcp-http-only=0'], async ({ child, stderr, waitUntil }) => {
    await waitUntil(() => stderr().includes('Stateless MCP HTTP listening'));
    child.send!('signal'); // Cross-platform event delivery; not a claim about Windows OS signals.
    await waitUntil(() => child.exitCode !== null);
    expect(child.exitCode).toBe(0);
    expect(stderr().match(/FIXTURE_ROOT_CLOSED/g)).toHaveLength(1);
  }, true);
}, 15000);

test('terminal stdio wire failure releases the root without waiting for stdin EOF', async () => {
  await withProcess([], async ({ child, stdout, stderr, waitUntil }) => {
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 91, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fault-stdio', version: '1.0.0' },
    } }) + '\n');
    await waitUntil(() => stdout().includes('"id":91'));
    child.send!('stdout-fault');
    await waitUntil(() => stderr().includes('FIXTURE_ROOT_CLOSED'));
    await waitUntil(() => child.exitCode !== null);
    expect(stderr().match(/FIXTURE_ROOT_CLOSED/g)).toHaveLength(1);
  }, true);
}, 15000);

test('a recoverable stdio parse error does not close the runtime or prevent negotiation', async () => {
  await withProcess([], async ({ child, stdout, stderr, waitUntil }) => {
    child.stdin!.write('not-json\n' + JSON.stringify({ jsonrpc: '2.0', id: 92, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'recovering-stdio', version: '1.0.0' },
    } }) + '\n');
    await waitUntil(() => stdout().includes('"id":92'));
    expect(stderr()).not.toContain('FIXTURE_ROOT_CLOSED');
    child.stdin!.end();
    await waitUntil(() => child.exitCode !== null);
    expect(child.exitCode).toBe(0);
    expect(stderr().match(/FIXTURE_ROOT_CLOSED/g)).toHaveLength(1);
  }, true);
}, 15000);

test('terminal stdio wire failure does not dispose a runtime still owned by HTTP', async () => {
  await withProcess(['--mcp-http=0'], async ({ child, stderr, waitUntil }) => {
    await waitUntil(() => stderr().includes('Stateless MCP HTTP listening'));
    child.send!('stdout-fault');
    await waitUntil(() => stderr().includes('fixture stdout failure'));
    const client = new Client({ name: 'surviving-http', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(stderr().match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)![0])));
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: { path: 'Probe.md', maxChars: 2000 } } });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain('SharedHttpProbe');
      expect(stderr()).not.toContain('FIXTURE_ROOT_CLOSED');
    } finally { await client.close(); }
    child.send!('signal');
    await waitUntil(() => child.exitCode !== null);
    expect(stderr().match(/FIXTURE_ROOT_CLOSED/g)).toHaveLength(1);
  }, true);
}, 15000);

test('legacy dual transport still answers stdio and keeps HTTP usable after stdio EOF', async () => {
  await withProcess(['--mcp-http=0'], async ({ child, stdout, stderr, waitUntil }) => {
    await waitUntil(() => /listening on http:\/\/127\.0\.0\.1:\d+\/mcp/.test(stderr()));
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 81, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dual-stdio', version: '1.0.0' },
    } }) + '\n');
    await waitUntil(() => stdout().split('\n').some(line => { try { return JSON.parse(line).id === 81; } catch { return false; } }));
    const reply = stdout().split('\n').map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(message => message.id === 81);
    expect(reply.result.serverInfo.name).toBe('mcpvault');
    child.stdin!.end();
    const client = new Client({ name: 'dual-http', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(stderr().match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)![0])));
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: { path: 'Probe.md', maxChars: 2000 } } });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result.content)).toContain('SharedHttpProbe');
    } finally { await client.close(); }
  });
}, 15000);
