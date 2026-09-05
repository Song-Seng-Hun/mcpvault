import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { randomUUID } from 'node:crypto';

let vault: string;
let fs: FileSystemService;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'mcpvault-visible-stats-')); fs = new FileSystemService(vault); });
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });

test('statistics exclude hidden owners before counts, bytes and recent selection and refresh visibility', async () => {
  const visible = '# Current\n';
  await writeFile(join(vault, 'Visible.md'), visible);
  for (const state of ['hidden', 'quarantined', 'removed']) await writeFile(join(vault, `${state}.md`), `---\nmoderation_status: ${state}\n---\nSecret body\n`);
  const first = await fs.getVaultStats(20);
  expect(first).toMatchObject({ totalNotes: 1, totalSize: Buffer.byteLength(visible), recentlyModified: [{ path: 'Visible.md' }] });
  expect(JSON.stringify(first)).not.toContain('hidden.md');
  await writeFile(join(vault, 'Visible.md'), '---\nmoderation_status: hidden\n---\n# Current\n');
  expect((await fs.getVaultStats()).totalNotes).toBe(0);
  await writeFile(join(vault, 'hidden.md'), visible);
  expect((await fs.getVaultStats()).recentlyModified.map(item => item.path)).toEqual(['hidden.md']);
});

test('recent count zero is a real empty sample and malformed counts reject', async () => {
  await writeFile(join(vault, 'Note.md'), '# Note');
  expect((await fs.getVaultStats(0)).recentlyModified).toEqual([]);
  for (const value of [-1, 1.5, NaN]) await expect(fs.getVaultStats(value)).rejects.toThrow(/recentCount/);
  const filtered = await fs.getVaultStats(20, () => false);
  expect(filtered).toMatchObject({ totalNotes: 0, totalSize: 0, recentlyModified: [] });
});

test('storage failures cannot produce successful statistics or expose driver details', async () => {
  await writeFile(join(vault, 'Note.md'), '# Note');
  const original = (fs as any).resolvePath.bind(fs);
  vi.spyOn(fs as any, 'resolvePath').mockImplementation((path: unknown) => {
    if (path === 'Note.md') throw Object.assign(new Error('private-driver-path'), { code: 'EACCES' });
    return original(path);
  });
  await expect(fs.getVaultStats()).rejects.toThrow('Vault read unavailable');
});

test('allowed derived files and empty visible directories retain explicit inventory semantics', async () => {
  await mkdir(join(vault, 'Empty'));
  const canvas = '{"nodes":[],"edges":[]}';
  await writeFile(join(vault, 'Map.canvas'), canvas);
  expect(await fs.getVaultStats(0)).toMatchObject({ totalNotes: 1, totalFolders: 1, totalSize: Buffer.byteLength(canvas), recentlyModified: [] });
});

test('oversized Markdown rejects without returning partial totals or the source name', async () => {
  await writeFile(join(vault, 'Sensitive.md'), 'x'.repeat(8 * 1024 * 1024 + 1));
  let failure: unknown;
  try { await fs.getVaultStats(); } catch (error) { failure = error; }
  expect(String(failure)).toMatch(/8 MiB.*no partial totals/);
  expect(String(failure)).not.toContain('Sensitive.md');
});

test('public statistics bound pretty recent samples, filter hidden owners and project private paths', async () => {
  await mkdir(join(vault, '_scopes/models/codex'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/codex/Private.md'), '# Private');
  await writeFile(join(vault, 'Hidden.md'), '---\nmoderation_status: hidden\n---\nSecret');
  for (let i = 0; i < 20; i++) await writeFile(join(vault, `Long-${i}-${'x'.repeat(70)}.md`), '# Note');
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'stats-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (endpointId: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const response = await call('mcp.get_vault_stats', { recentCount: 20, maxChars: 512, prettyPrint: true });
    expect(response.isError).toBeFalsy();
    const text = (response.content as any)[0].text;
    expect(text.length).toBeLessThanOrEqual(512);
    const value = JSON.parse(text);
    expect(value.notes).toBe(20);
    expect(value.truncated).toBe(true);
    expect(text).not.toMatch(/Hidden.md|Private.md/);
    expect(value.returnedRecent).toBe(value.recent.length);
    const zero = await call('mcp.get_vault_stats', { recentCount: 0 });
    expect(JSON.parse((zero.content as any)[0].text).recent).toEqual([]);
    const registration = await call('auth.register', { accountId: 'stats-test', modelId: 'codex', password: randomUUID() });
    const accessToken = JSON.parse((registration.content as any)[0].text).accessToken;
    await writeFile(join(vault, '_scopes/models/codex/Private.md'), '# Updated private');
    const own = await call('mcp.get_vault_stats', { recentCount: 1, maxChars: 512, accessToken });
    expect(own.isError).toBeFalsy();
    expect(JSON.parse((own.content as any)[0].text).recent[0].path).toBe('scope://model/codex/Private.md');
  } finally { await client.close(); await server.close(); }
});
