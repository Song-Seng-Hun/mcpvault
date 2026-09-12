import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCliArgs } from './cli.js';
import { ScopeAuthService } from './scope-auth.js';
import { ModerationService } from './moderation.js';
import { FileSystemService } from './filesystem.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { SearchService } from './search.js';
import { createServer, getServerRuntime } from '../tests/server-fixture.js';
let vault: string;
const servers: Array<ReturnType<typeof createServer>> = [];
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'maintenance-runtime-')); });
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('maintenance CLI requires one explicit host file and does not alter the Vault argument', () => {
  for (const args of [['--maintenance-config', 'C:/Host/maintenance.json', vault], ['--maintenance-config=C:/Host/maintenance.json', vault]]) {
    expect(parseCliArgs(args)).toMatchObject({ maintenanceConfig: 'C:/Host/maintenance.json', vaultPathArg: vault });
  }
  for (const args of [['--maintenance-config'], ['--maintenance-config='], ['--maintenance-config', '--read-only'], ['--maintenance-config=a', '--maintenance-config=b']]) {
    expect(() => parseCliArgs(args)).toThrow();
  }
});

test('fresh maintenance account lookup bypasses both principal and database caches', async () => {
  const auth = new ScopeAuthService(vault);
  await auth.register({ accountId: 'operator', modelId: 'test', password: 'isolated-fixture-password' });
  expect((await auth.listPrincipals())[0]?.capabilities).toContain('write');
  const path = join(vault, '.mcpvault', 'scope-auth.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  value.accounts[0].capabilities = []; await writeFile(path, JSON.stringify(value));
  expect((await auth.listPrincipals({ fresh: true }))[0]?.capabilities).not.toContain('write');
});

test('maintenance moderation lookup sees an external ban without waiting for cached reads', async () => {
  const auth = new ScopeAuthService(vault);
  await auth.register({ accountId: 'operator', modelId: 'test', password: 'isolated-fixture-password' });
  const moderation = new ModerationService(vault, new FileSystemService(vault), auth);
  expect(await moderation.isBanned('operator')).toBe(false);
  await writeFile(join(vault, '.mcpvault', 'moderation.json'), JSON.stringify({ version: 1, reports: [], actions: [], bans: [{ accountId: 'operator', active: true }] }));
  expect(await moderation.isBanned('operator', undefined, { fresh: true })).toBe(true);
});

test('exception board defaults to compact grouped output while explicit legacy view remains available', async () => {
  await writeFile(join(vault, 'A.md'), '---\nllm_wiki_type: knowledge\nnote_kind: atomic\nlifecycle: impossible\n---\n# A\n');
  const server = createServer(vault); servers.push(server); const runtime = getServerRuntime(server);
  async function board(args: Record<string, unknown>) {
    const result = await runtime.dispatchTool('call_endpoint', { endpointId: 'wiki.exception_board', arguments: args });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>).filter(row => row.type === 'text').map(row => row.text).join('');
    return { text, value: JSON.parse(text) };
  }
  const grouped = await board({ maxChars: 16000 });
  expect(grouped.value.groups.some((row: any) => row.path === 'A.md')).toBe(true);
  const small = await board({ maxChars: 1200, prettyPrint: true });
  expect(Array.isArray(small.value.groups)).toBe(true); expect(small.text.length).toBeLessThanOrEqual(1200);
  const legacy = await board({ grouped: false, maxChars: 16000 });
  expect(Array.isArray(legacy.value.items)).toBe(true); expect(legacy.value.groups).toBeUndefined();
});

test('read-only runtime never acquires or reads autonomous host state even when supplied', async () => {
  const host = { refresh: vi.fn(async () => ({ version: 1 as const, enabled: true, accountId: 'operator', paths: ['A.md'], operations: ['cache_refresh' as const] })),
    readState: vi.fn(async () => undefined), writeState: vi.fn(async () => {}), acquire: vi.fn(async () => ({ assertHeld: async () => {}, close: async () => {} })) };
  const server = createServer(vault, { readOnly: true, maintenance: host }); servers.push(server);
  await getServerRuntime(server).dispatchTool('call_endpoint', { endpointId: 'wiki.exception_board', arguments: { maxChars: 1200 } });
  expect(host.acquire).not.toHaveBeenCalled(); expect(host.readState).not.toHaveBeenCalled(); expect(host.writeState).not.toHaveBeenCalled();
});

test('an explicit host starts a verified cache job through the existing runtime', async () => {
  const auth = new ScopeAuthService(vault);
  await auth.register({ accountId: 'operator', modelId: 'test', password: 'isolated-fixture-password' });
  await writeFile(join(vault, 'A.md'), '# Cache fixture\nCurrent Markdown.');
  let state: any;
  const host = { refresh: async () => ({ version: 1 as const, enabled: true, accountId: 'operator', paths: ['A.md'], operations: ['cache_refresh' as const] }),
    readState: async () => state, writeState: async (value: unknown) => { state = structuredClone(value); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }) };
  const server = createServer(vault, { maintenance: host }); servers.push(server);
  await vi.waitFor(() => expect(state?.jobs?.[0]?.status).toBe('verified'), { timeout: 4000 });
  expect(state.jobs).toHaveLength(1); expect(state.jobs[0].operation).toBe('cache_refresh');
  expect(await readFile(join(vault, 'A.md'), 'utf8')).toBe('# Cache fixture\nCurrent Markdown.');
});

test('a refused foreign-writer cleanup still closes remaining runtime resources', async () => {
  const auth = new ScopeAuthService(vault);
  await auth.register({ accountId: 'operator', modelId: 'test', password: 'isolated-fixture-password' });
  await writeFile(join(vault, 'A.md'), '# Cache fixture'); let state: any;
  const host = { refresh: async () => ({ version: 1 as const, enabled: true, accountId: 'operator', paths: ['A.md'], operations: ['cache_refresh' as const] }),
    readState: async () => state, writeState: async (value: unknown) => { state = structuredClone(value); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => { throw new Error('Foreign writer preserved'); } }) };
  const server = createServer(vault, { maintenance: host });
  await vi.waitFor(() => expect(state?.jobs?.[0]?.status).toBe('verified'), { timeout: 4000 });
  const closeCatalog = vi.spyOn(VaultFileCatalog.prototype, 'close'); const closeSearch = vi.spyOn(SearchService.prototype, 'close');
  try { await expect(server.close()).rejects.toThrow(); expect(closeCatalog).toHaveBeenCalled(); expect(closeSearch).toHaveBeenCalled(); }
  finally { if (!closeCatalog.mock.calls.length) { host.acquire = async () => ({ assertHeld: async () => {}, close: async () => {} }); await server.close(); } }
});
