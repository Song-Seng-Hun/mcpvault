import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer, getServerRuntime } from './createServer.js';
import { startMcpHttpApi, type McpHttpHandle } from './mcp-http.js';
import { startRestApi } from './rest-api.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultGraphIndex } from './vault-graph.js';
import { SearchService } from './search.js';
import { SemanticSearchService } from './semantic-search.js';
import * as wikiTools from './llm-wiki-tools.js';

const owners = vi.hoisted(() => ({ catalog: 0, metadata: 0, graph: 0, search: 0, semantic: 0 }));
// Constructor witnesses preserve real services; no resource logic is replaced.
vi.mock('./vault-catalog.js', async original => {
  const mod = await original<typeof import('./vault-catalog.js')>();
  return { ...mod, VaultFileCatalog: class extends mod.VaultFileCatalog {
    constructor(...args: ConstructorParameters<typeof mod.VaultFileCatalog>) { super(...args); owners.catalog++; }
  } };
});
vi.mock('./vault-index.js', async original => {
  const mod = await original<typeof import('./vault-index.js')>();
  return { ...mod, VaultMetadataIndex: class extends mod.VaultMetadataIndex {
    constructor(...args: ConstructorParameters<typeof mod.VaultMetadataIndex>) { super(...args); owners.metadata++; }
  } };
});
vi.mock('./vault-graph.js', async original => {
  const mod = await original<typeof import('./vault-graph.js')>();
  return { ...mod, VaultGraphIndex: class extends mod.VaultGraphIndex {
    constructor(...args: ConstructorParameters<typeof mod.VaultGraphIndex>) { super(...args); owners.graph++; }
  } };
});
vi.mock('./search.js', async original => {
  const mod = await original<typeof import('./search.js')>();
  return { ...mod, SearchService: class extends mod.SearchService {
    constructor(...args: ConstructorParameters<typeof mod.SearchService>) { super(...args); owners.search++; }
  } };
});
vi.mock('./semantic-search.js', async original => {
  const mod = await original<typeof import('./semantic-search.js')>();
  return { ...mod, SemanticSearchService: class extends mod.SemanticSearchService {
    constructor(...args: ConstructorParameters<typeof mod.SemanticSearchService>) { super(...args); owners.semantic++; }
  } };
});
afterEach(() => { vi.restoreAllMocks(); for (const key of Object.keys(owners) as Array<keyof typeof owners>) owners[key] = 0; });
async function fixture(run: (ctx: {
  seed: (path: string, content: string) => Promise<void>;
  create: () => ReturnType<typeof createServer>;
  expose: (server: ReturnType<typeof createServer>) => Promise<McpHttpHandle>;
  connect: (api: McpHttpHandle) => Promise<Client>;
}) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-runtime-sharing-', vault = await mkdtemp(join(base, prefix));
  const servers: ReturnType<typeof createServer>[] = [], apis: McpHttpHandle[] = [], clients: Client[] = [];
  try {
    await run({
      seed: async (path, content) => {
        const target = join(vault, path), rel = relative(vault, target);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe fixture seed');
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      },
      create: () => { const server = createServer(vault, { version: '1.0.0' }); servers.push(server); return server; },
      expose: async server => { const api = await startMcpHttpApi(server, { port: 0 }); apis.push(api); return api; },
      connect: async api => {
        const client = new Client({ name: `fixture-client-${clients.length}`, version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
        clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${api.port}${api.path}`)));
        return client;
      },
    });
  } finally {
    for (const client of clients) await client.close();
    for (const api of apis) await api.close();
    for (const server of servers) await server.close();
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('endpoint auth schema is complete before a client first lists tools', async () => {
  await fixture(async ({ create }) => {
    const runtime = getServerRuntime(create())!;
    expect((runtime.endpointRegistry.resolve('notes.read')!.input.properties as any).accessToken).toMatchObject({ type: 'string' });
  });
});

test('two HTTP clients reuse the prepared catalog across repeated tools/list calls', async () => {
  await fixture(async ({ create, expose, connect }) => {
    const server = create(), runtime = getServerRuntime(server)!;
    const descriptor = runtime.endpointRegistry.resolve('notes.read'), rebuild = vi.spyOn(runtime.endpointRegistry, 'setTools');
    const schemaBefore = JSON.stringify(descriptor!.input);
    const rest = await startRestApi(server, { port: 0 });
    await rest.close();
    const api = await expose(server), first = await connect(api), second = await connect(api);
    const lists = await Promise.all([first.listTools(), second.listTools(), first.listTools(), second.listTools()]);
    runtime.ensureEndpointRegistry(); runtime.ensureEndpointRegistry();
    for (const list of lists) expect(list.tools.map(tool => tool.name).sort()).toEqual([
      'call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities',
    ]);
    expect(rebuild.mock.calls.length).toBe(0);
    expect(runtime.endpointRegistry.resolve('notes.read')).toBe(descriptor);
    expect(JSON.stringify(descriptor!.input) === schemaBefore).toBe(true);
  });
});

test('HTTP requests share one service bundle; separate runtimes create separate owners', async () => {
  await fixture(async ({ create, expose, connect, seed }) => {
    await seed('Probe.md', '# Probe\nResourceProbe');
    const server = create(), runtime = getServerRuntime(server)!;
    const closes = [vi.spyOn(VaultFileCatalog.prototype, 'close'), vi.spyOn(VaultMetadataIndex.prototype, 'close'),
      vi.spyOn(VaultGraphIndex.prototype, 'close'), vi.spyOn(SearchService.prototype, 'close'), vi.spyOn(SemanticSearchService.prototype, 'close')];
    const bundle = { catalog: 1, metadata: 1, graph: 1, search: 1, semantic: 1 };
    expect(owners).toEqual(bundle);
    const wrappers = vi.spyOn(runtime, 'createRequestServer');
    const api = await expose(server), first = await connect(api), second = await connect(api);
    await Promise.all([first.listTools(), second.listTools(), first.listTools(), second.listTools()]);
    expect(owners).toEqual(bundle);
    expect(wrappers.mock.calls.length).toBeGreaterThanOrEqual(4);
    const requestServers = wrappers.mock.results.map(result => result.value);
    expect(new Set(requestServers).size).toBe(requestServers.length);
    expect(requestServers).not.toContain(server);
    await first.close(); expect((await second.listTools()).tools).toHaveLength(5);
    const search = await second.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'wiki.search', arguments: { query: 'ResourceProbe', limit: 1, maxChars: 2000, semantic: false },
    } });
    expect(search.isError).toBeFalsy();
    expect(JSON.stringify(search.content)).toContain('Probe.md');
    expect(closes.map(close => close.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    expect(owners).toEqual(bundle);
    const separate = getServerRuntime(create())!;
    expect(owners).toEqual({ catalog: 2, metadata: 2, graph: 2, search: 2, semantic: 2 });
    expect(separate.endpointRegistry).not.toBe(runtime.endpointRegistry);
    expect(separate.endpointRegistry.resolve('notes.read')).not.toBe(runtime.endpointRegistry.resolve('notes.read'));
  });
});

test('shared runtime authenticates each concurrent call independently and retains anonymous access', async () => {
  await fixture(async ({ create, expose, connect, seed }) => {
    for (let i = 0; i < 2; i++) await seed(`_scopes/agents/fixture-owner-${i}/Secret.md`, `only-owner-${i}`);
    const api = await expose(create()), first = await connect(api), second = await connect(api);
    const call = async (client: Client, endpointId: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
      expect(result.isError).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const accounts = await Promise.all([first, second].map((client, i) => call(client, 'auth.register', {
      accountId: `fixture-owner-${i}`, userId: `fixture-family-${i}`, modelId: 'codex', agentId: `fixture-owner-${i}`,
      password: `disposable-fixture-password-${i}`,
    })));
    const answers = await Promise.all([
      call(first, 'auth.whoami', { accessToken: accounts[0].accessToken }),
      call(second, 'auth.whoami', { accessToken: accounts[1].accessToken }),
      call(first, 'auth.whoami'), call(second, 'auth.whoami'),
    ]);
    expect(answers.map(answer => answer.accountId || answer.role)).toEqual(['fixture-owner-0', 'fixture-owner-1', 'global', 'global']);
    const reads = await Promise.all([
      [first, accounts[0].accessToken, 0], [second, accounts[1].accessToken, 1],
      [second, accounts[1].accessToken, 0], [first, undefined, 0],
    ].map(([client, accessToken, owner]) => (client as Client).callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'notes.read', arguments: { path: `scope://agent/fixture-owner-${owner}/Secret.md`, maxChars: 2000, ...(accessToken && { accessToken }) },
    } })));
    for (let i = 0; i < 2; i++) {
      expect(reads[i].isError).toBeFalsy();
      expect(JSON.stringify(reads[i].content)).toContain(`only-owner-${i}`);
    }
    for (const denied of reads.slice(2)) {
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).not.toContain('only-owner-0');
    }
    await first.close();
    expect((await call(second, 'auth.whoami', { accessToken: accounts[1].accessToken })).accountId).toBe('fixture-owner-1');
  });
});

test('catalog preparation does not mutate tool-module input schemas', async () => {
  const tools = wikiTools.getLlmWikiTools(), before = JSON.stringify(tools);
  vi.spyOn(wikiTools, 'getLlmWikiTools').mockReturnValue(tools);
  await fixture(async ({ create, expose, connect }) => {
    const server = create(), client = await connect(await expose(server));
    await client.listTools();
    expect(JSON.stringify(tools) === before).toBe(true);
  });
});

test('permission changes refresh discovery and execution without rebuilding the shared catalog', async () => {
  await fixture(async ({ create, expose, connect }) => {
    const server = create(), runtime = getServerRuntime(server)!;
    const rebuild = vi.spyOn(runtime.endpointRegistry, 'setTools');
    const api = await expose(server), first = await connect(api), second = await connect(api);
    const call = async (endpointId: string, args: Record<string, unknown>) => {
      const result = await first.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
      expect(result.isError).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const owner = await call('auth.register', { accountId: 'fixture-model', userId: 'fixture-family', modelId: 'codex', password: 'disposable-model-password' });
    const credentials = { accountId: 'fixture-worker', password: 'disposable-worker-password' };
    const agent = await call('auth.register', { ...credentials, userId: 'fixture-family', modelId: 'codex', agentId: 'fixture-worker', accessToken: owner.accessToken });
    const discover = async (client: Client, accessToken?: string) => {
      const result = await client.callTool({ name: 'search_capabilities', arguments: { query: 'notes.write', limit: 1, maxChars: 4000, ...(accessToken && { accessToken }) } });
      expect(result.isError).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text).endpoints[0];
    };
    const initial = await Promise.all([discover(first, agent.accessToken), discover(second)]);
    expect(initial.map(entry => [entry.endpointId, entry.available])).toEqual([['notes.write', true], ['notes.write', false]]);
    for (const allowed of [false, true]) {
      await call('mcp.update_agent_capabilities', { accessToken: owner.accessToken, agentId: 'fixture-worker', capabilities: allowed ? ['write', 'chat'] : ['chat'] });
      const login = await call('auth.login', credentials);
      const views = await Promise.all([discover(first, login.accessToken), discover(second)]);
      expect(views.map(entry => entry.available)).toEqual([allowed, false]);
      const write = await second.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
        path: 'PermissionProbe.md', content: 'permission-probe', expectedRevision: 'missing', accessToken: login.accessToken,
      } } });
      expect(Boolean(write.isError)).toBe(!allowed);
      if (!allowed) expect(JSON.stringify(write.content)).toContain('not granted');
      else expect(JSON.stringify(await call('notes.read', { path: 'PermissionProbe.md', maxChars: 2000 }))).toContain('permission-probe');
    }
    const revoked = await second.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.write', arguments: {
      path: 'RevokedProbe.md', content: 'must not write', accessToken: agent.accessToken,
    } } });
    expect(revoked.isError).toBe(true);
    expect(rebuild.mock.calls.length).toBe(0);
  });
});
