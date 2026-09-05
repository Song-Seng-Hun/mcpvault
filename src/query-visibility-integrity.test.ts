import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FileSystemService } from './filesystem.js';
import { isModerationHidden } from './moderation-policy.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;
const note = (status = 'visible', body = 'Public body') => `---\ngroup: query-test\nmoderation_status: ${status}\n---\n${body}`;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-query-integrity-'));
  for (const prefix of ['Knowledge', 'Community/Posts']) {
    await mkdir(join(vault, prefix), { recursive: true });
    await writeFile(join(vault, prefix, '00-hidden.md'), note('hidden', 'PrivateMarker'));
    await writeFile(join(vault, prefix, '01-visible.md'), note());
    await writeFile(join(vault, prefix, '02-hidden.md'), note('quarantined', 'QuarantinedMarker'));
    await writeFile(join(vault, prefix, '03-visible.md'), note());
  }
  server = createServer(vault, { version: 'query-integrity' });
  client = new Client({ name: 'query-integrity', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { vi.restoreAllMocks(); await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function query(args: any = {}) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'mcp.query_notes', arguments: { pathPrefix: 'Knowledge', filters: { group: 'query-test' }, limit: 1, maxChars: 2000, ...args } } });
  const text = (result.content as any)[0].text as string;
  expect(text.length).toBeLessThanOrEqual(2000);
  return { result, text, value: text.startsWith('{') ? JSON.parse(text) : undefined };
}

test.each([true, false])('visible rows define counts and cursor pages with includeTotal=%s', async includeTotal => {
  for (const pathPrefix of ['Knowledge', 'Community/Posts']) {
    for (const includeContent of [false, true]) {
      const first = await query({ pathPrefix, includeTotal, includeContent });
      expect(first.result.isError).not.toBe(true);
      expect(first.value.notes.map((n: any) => n.path)).toEqual([`${pathPrefix}/01-visible.md`]);
      expect(first.value.total).toBe(includeTotal ? 2 : -1);
      expect(first.value.truncated).toBe(true);
      expect(first.value.nextCursor.path).toBe(`${pathPrefix}/01-visible.md`);
      const second = await query({ pathPrefix, includeTotal, includeContent, after: first.value.nextCursor });
      expect(second.value.notes.map((n: any) => n.path)).toEqual([`${pathPrefix}/03-visible.md`]);
      expect(second.value.truncated).toBe(false);
      expect(second.value.nextCursor).toBeUndefined();
      expect(first.text + second.text).not.toMatch(/PrivateMarker|QuarantinedMarker|00-hidden|02-hidden/);
    }
  }
});

async function afterSelection(includeTotal: boolean, action: () => Promise<void>) {
  if (includeTotal) {
    const original = VaultMetadataIndex.prototype.listSorted;
    vi.spyOn(VaultMetadataIndex.prototype, 'listSorted').mockImplementation(async function(this: VaultMetadataIndex, ...args) {
      const rows = await original.apply(this, args);
      await action();
      return rows;
    });
  } else {
    const original = VaultMetadataIndex.prototype.listSortedPage;
    vi.spyOn(VaultMetadataIndex.prototype, 'listSortedPage').mockImplementation(async function(this: VaultMetadataIndex, ...args) {
      const rows = await original.apply(this, args);
      await action();
      return rows;
    });
  }
}

test.each([true, false])('hydration rejects changed/hidden sources instead of attaching old metadata (includeTotal=%s)', async includeTotal => {
  await afterSelection(includeTotal, async () => {
    await writeFile(join(vault, 'Knowledge/01-visible.md'), note('hidden', 'NewPrivateMarker'));
  });
  const changed = await query({ includeTotal, includeContent: true, pathPrefix: 'Knowledge/01-visible.md' });
  expect(changed.result.isError).toBe(true);
  expect(changed.text).toMatch(/query.*changed|snapshot.*changed/i);
  expect(changed.text).not.toContain('NewPrivateMarker');
});

test.each([true, false])('hydration preserves storage failure instead of returning an empty success (includeTotal=%s)', async includeTotal => {
  let selected = false;
  await afterSelection(includeTotal, async () => { selected = true; });
  const original = VaultIoCoordinator.prototype.readUtf8Bounded;
  vi.spyOn(VaultIoCoordinator.prototype, 'readUtf8Bounded').mockImplementation(async function(this: VaultIoCoordinator, path: string, maxBytes: number) {
    if (selected && path.endsWith('01-visible.md')) throw Object.assign(new Error('DriverSecretPath'), { code: 'EACCES' });
    return original.call(this, path, maxBytes);
  });
  const failure = await query({ includeTotal, includeContent: true, pathPrefix: 'Knowledge/01-visible.md' });
  expect(failure.result.isError).toBe(true);
  expect(failure.text).toContain('Vault read unavailable');
  expect(failure.text).not.toContain('DriverSecretPath');
});

test.each([true, false])('one changed source rejects even the successful rows of a hydrated page (includeTotal=%s)', async includeTotal => {
  await afterSelection(includeTotal, async () => {
    await writeFile(join(vault, 'Knowledge/03-visible.md'), note('hidden', 'NewPrivateMarker'));
  });
  const page = await query({ includeTotal, includeContent: true, limit: 2 });
  expect(page.result.isError).toBe(true);
  expect(page.text).toContain('Query snapshot changed');
  expect(page.text).not.toMatch(/Public body|NewPrivateMarker|01-visible|03-visible/);
});

test.each([true, false])('a selected source disappearing invalidates the whole page (includeTotal=%s)', async includeTotal => {
  await afterSelection(includeTotal, async () => { await rm(join(vault, 'Knowledge/01-visible.md')); });
  const deleted = await query({ includeTotal, includeContent: true, pathPrefix: 'Knowledge/01-visible.md' });
  expect(deleted.result.isError).toBe(true);
  expect(deleted.text).toContain('Query snapshot changed');
  expect(deleted.text).toContain('without after/offset');
});

test('unindexed queries apply the same row predicate before counts and offset, without changing internal defaults', async () => {
  const fs = new FileSystemService(vault);
  const params = { pathPrefix: 'Knowledge', filters: { group: 'query-test' }, limit: 1, offset: 1, includeContent: true };
  const visible = await fs.queryNotes(params, () => true, row => !isModerationHidden(row.frontmatter));
  expect(visible.total).toBe(2);
  expect(visible.notes.map(n => n.path)).toEqual(['Knowledge/03-visible.md']);
  expect(visible.truncated).toBe(false);
  const internal = await fs.queryNotes({ ...params, offset: 0 });
  expect(internal.total).toBe(4);
  const pageOnly = await fs.queryNotes({ ...params, includeTotal: false }, () => true, row => !isModerationHidden(row.frontmatter));
  expect(pageOnly).toMatchObject({ total: -1, totalKnown: false, truncated: false });
  expect(pageOnly.notes.map(n => n.path)).toEqual(['Knowledge/03-visible.md']);
});
