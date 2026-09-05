import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultIoCoordinator } from './vault-io.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-query-delivery-'));
  await mkdir(join(vault, 'Knowledge'));
  for (let i = 0; i < 12; i++) await writeFile(join(vault, `Knowledge/N${String(i).padStart(2, '0')}.md`), `---\nrank: ${i}\ndetail: ${'a'.repeat(80)}\n---\n# Note ${i}\nBody`);
  server = createServer(vault, { version: 'query-delivery' });
  client = new Client({ name: 'query-delivery', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { vi.restoreAllMocks(); await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function query(args: Record<string, unknown>) {
  const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'mcp.query_notes', arguments: { pathPrefix: 'Knowledge', limit: 12, maxChars: 512, ...args } } });
  const text = (response.content as Array<{ text: string }>)[0]!.text;
  expect(text.length).toBeLessThanOrEqual(Number(args.maxChars ?? 512));
  return { response, value: JSON.parse(text) };
}

test.each([true, false])('tiny public pages deliver every row exactly once (includeTotal=%s)', async includeTotal => {
  const paths: string[] = [];
  let after: unknown;
  for (let step = 0; step < 15; step++) {
    const { response, value } = await query({ includeTotal, ...(after ? { after } : {}) });
    expect(response.isError).not.toBe(true);
    expect(value.notes?.length).toBeGreaterThan(0);
    paths.push(...value.notes.map((n: { path: string }) => n.path));
    expect(value.total).toBe(includeTotal ? 12 : -1);
    if (!value.truncated) { expect(value.nextCursor).toBeUndefined(); break; }
    expect(value.nextCursor.path).toBe(value.notes.at(-1).path);
    expect(value.nextCursor).not.toEqual(after);
    after = value.nextCursor;
  }
  expect(paths).toEqual(Array.from({ length: 12 }, (_, i) => `Knowledge/N${String(i).padStart(2, '0')}.md`));
});

test('nested descending sort survives omitted Properties and a missing sort field', async () => {
  for (let i = 0; i < 12; i++) await writeFile(join(vault, `Knowledge/N${String(i).padStart(2, '0')}.md`), `---\n${i === 0 ? '' : `priority:\n  rank: ${i}\n`}detail: ${'x'.repeat(i === 11 ? 9000 : 80)}\n---\n# Note`);
  const paths: string[] = [];
  let after: unknown;
  for (let step = 0; step < 16; step++) {
    const { response, value } = await query({ sortBy: 'priority.rank', sortOrder: 'desc', includeTotal: false, prettyPrint: true, ...(after ? { after } : {}) });
    expect(response.isError).not.toBe(true);
    expect(value.notes.length).toBeGreaterThan(0);
    if (step === 0) { expect(value.notes[0].frontmatterOmitted).toBe(true); expect(value.nextCursor.value).toBe(11); }
    paths.push(...value.notes.map((n: { path: string }) => n.path));
    if (!value.truncated) break;
    expect(value.nextCursor.path).toBe(value.notes.at(-1).path);
    after = value.nextCursor;
  }
  expect(paths).toEqual(Array.from({ length: 12 }, (_, i) => `Knowledge/N${String(11 - i).padStart(2, '0')}.md`));
});

test('source read attempts share a one-MiB ceiling and oversized rows have usable recovery', async () => {
  for (let i = 0; i < 12; i++) await writeFile(join(vault, `Knowledge/N${String(i).padStart(2, '0')}.md`), `# Note ${i}\n${'x'.repeat(300_000)}`);
  // Warm metadata separately: these limits cover query hydration, not index construction.
  await query({ limit: 1 });
  const original = VaultIoCoordinator.prototype.readUtf8Bounded;
  const limits: number[] = [];
  vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8Bounded').mockImplementation(function(this: VaultIoCoordinator, path: string, maxBytes: number) {
    limits.push(maxBytes); return original.call(this, path, maxBytes);
  });
  const { response, value } = await query({ includeContent: true, maxChars: 20000 });
  expect(response.isError).not.toBe(true);
  expect(value.notes).toHaveLength(12);
  expect(value.truncated).toBe(false);
  expect(limits.length).toBeGreaterThan(0);
  expect(limits.every(limit => limit <= 256 * 1024)).toBe(true);
  expect(limits.reduce((sum, limit) => sum + limit + 1, 0)).toBeLessThanOrEqual(1024 * 1024);
  for (const row of value.notes) {
    expect(row).toMatchObject({ contentOmitted: true, sourceState: 'index_advisory' });
    expect(row.content).toBeUndefined();
  }
  const action = value.notes[0].nextAction;
  const follow = await client.callTool({ name: 'call_endpoint', arguments: action });
  expect(follow.isError).not.toBe(true);
  const text = (follow.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('Note 0');
  expect(text).toContain(value.notes[0].revision);
  await writeFile(join(vault, 'Knowledge/N00.md'), '# Changed');
  const changed = await client.callTool({ name: 'call_endpoint', arguments: action });
  expect(changed.isError).toBe(true);
  expect(JSON.stringify(changed.content)).toContain('revision_conflict');
});

test('a tiny body page does not hydrate all selected candidates', async () => {
  await query({ limit: 1 });
  const reads = vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8Bounded');
  const { response, value } = await query({ includeContent: true });
  expect(response.isError).not.toBe(true);
  expect(value.notes.length).toBeGreaterThan(0);
  expect(reads.mock.calls.length).toBeLessThan(4);
  expect(value.nextCursor.path).toBe(value.notes.at(-1).path);
});
