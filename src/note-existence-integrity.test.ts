import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { createServer } from './createServer.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const faults = vi.hoisted(() => ({ stat: new Map<string, string>(), createBeforeWrite: new Map<string, string>() }));
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real,
    stat: async (...args: Parameters<typeof real.stat>) => {
      const code = faults.stat.get(String(args[0]));
      if (code) throw Object.assign(new Error(`private-driver-detail ${args[0]}`), { code });
      return real.stat(...args);
    },
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      const path = String(args[0]), raced = faults.createBeforeWrite.get(path);
      if (raced !== undefined) {
        faults.createBeforeWrite.delete(path);
        await real.writeFile(path, raced);
      }
      return real.writeFile(...args);
    },
  };
});
const vaults: string[] = [];
afterEach(async () => {
  faults.stat.clear(); faults.createBeforeWrite.clear();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-existence-integrity-')); vaults.push(vault);
  let writes = 0;
  const fs = new FileSystemService(vault, undefined, undefined, () => { writes++; });
  await writeFile(join(vault, 'Note.md'), '# Keep existing knowledge');
  return { vault, fs, writes: () => writes };
}

test.each(['EIO', 'EACCES', 'EPERM'])('note existence %s is unavailable, not absent', async code => {
  const { vault, fs } = await fixture();
  faults.stat.set(join(vault, 'Note.md'), code);
  await expect(fs.noteExists('Note.md')).rejects.toThrow(/^Vault read unavailable; retry after storage access is restored\.$/);
});

test.each(['EIO', 'EACCES', 'EPERM'])('a missing write guard cannot overwrite an existing note after stat %s', async code => {
  const { vault, fs, writes } = await fixture();
  faults.stat.set(join(vault, 'Note.md'), code);
  const result = await fs.writeNoteWithReceipt({ path: 'Note.md', content: 'Replacement', expectedRevision: 'missing' }).catch(error => error);
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe('# Keep existing knowledge');
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).not.toContain('private-driver-detail');
  expect(writes()).toBe(0);
});

test.each(['overwrite', 'append', 'prepend'] as const)('guarded %s creation cannot overwrite a file appearing immediately before write', async mode => {
  const { vault, fs, writes } = await fixture();
  faults.createBeforeWrite.set(join(vault, 'Race.md'), '# Created by another writer');
  const result = await fs.writeNoteWithReceipt({ path: 'Race.md', mode, content: '# Ours', expectedRevision: 'missing' }).catch(error => error);
  expect(await readFile(join(vault, 'Race.md'), 'utf8')).toBe('# Created by another writer');
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toMatch(/revision conflict/i);
  expect(writes()).toBe(0);
});

test('genuine absence and non-file existence semantics remain usable', async () => {
  const { vault, fs, writes } = await fixture();
  expect(await fs.noteExists('Missing.md')).toBe(false);
  await mkdir(join(vault, 'Folder'));
  expect(await fs.noteExists('Folder')).toBe(false);
  expect(await fs.noteExists('Note.md')).toBe(true);
  faults.stat.set(join(vault, '.git/config'), 'EIO');
  expect(await fs.noteExists('.git/config')).toBe(false);
  const receipt = await fs.writeNoteWithReceipt({ path: 'Created.md', content: '# Created', expectedRevision: 'missing' });
  expect(receipt.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await readFile(join(vault, 'Created.md'), 'utf8')).toBe('# Created');
  expect(writes()).toBe(1);
});

test.each([false, true])('MCP new-note creation rejects a last-moment collision (explicit guard=%s)', async explicit => {
  const { vault } = await fixture();
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'existence-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (endpointId: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const registered = await call('auth.register', { accountId: 'existence-test', modelId: 'codex', password: randomUUID() });
    expect(registered.isError).toBeFalsy();
    const accessToken = JSON.parse((registered.content as any)[0].text).accessToken;
    faults.createBeforeWrite.set(join(vault, 'Race.md'), '# Other writer');
    const result = await call('notes.write', { path: 'Race.md', content: '# Ours', accessToken, ...(explicit && { expectedRevision: 'missing' }) });
    expect(await readFile(join(vault, 'Race.md'), 'utf8')).toBe('# Other writer');
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toMatch(/revision conflict/i);
  } finally { await client.close(); await server.close(); }
});
