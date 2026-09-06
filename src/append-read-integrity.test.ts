import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { readBoundedSource } from './bounded-source-read.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const original = '---\ntitle: Preserve me\n---\nAuthoritative knowledge.\n';

async function fixture(intercept?: (path: string, raw: string, count: number) => Promise<void>) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-append-integrity-')); vaults.push(vault);
  let count = 0, writes = 0;
  const read = async (path: string, maxBytes?: number) => {
    const raw = maxBytes === undefined ? await readFile(path, 'utf8') : await readBoundedSource(path, maxBytes);
    await intercept?.(path, raw, ++count);
    return raw;
  };
  const io = new VaultIoCoordinator({ reader: path => read(path), boundedReader: (path, cap) => read(path, cap) });
  const fs = new FileSystemService(vault, undefined, undefined, () => { writes++; }, undefined, undefined, io);
  await writeFile(join(vault, 'Note.md'), original);
  return { vault, fs, writes: () => writes };
}

for (const mode of ['append', 'prepend'] as const) {
  test.each(['EIO', 'EACCES', 'EPERM'])(`${mode} read %s after a valid guard cannot replace the original`, async code => {
    const { vault, fs, writes } = await fixture(async (_path, _raw, count) => {
      if (count === 2) throw Object.assign(new Error('Storage read failed (not a missing-file result)'), { code });
    });
    const outcome = await fs.writeNoteWithReceipt({ path: 'Note.md', mode, content: 'Addition only.', expectedRevision: hash(original) }).catch(error => error);
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(original);
    expect(outcome).toBeInstanceOf(Error);
    expect(writes()).toBe(0);
  });

  test.each(['edited', 'deleted'])(`${mode} rejects source %s between guard and merge hydration`, async change => {
    const later = '# A different editor changed the source\n';
    const { vault, fs, writes } = await fixture(async (path, _raw, count) => {
      if (count !== 1) return;
      if (change === 'deleted') await rm(path);
      else await writeFile(path, later);
    });
    await expect(fs.writeNoteWithReceipt({ path: 'Note.md', mode, content: 'Addition only.', expectedRevision: hash(original) })).rejects.toThrow(/revision conflict/i);
    expect(writes()).toBe(0);
    if (change === 'deleted') await expect(readFile(join(vault, 'Note.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    else expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(later);
  });

  test(`${mode} may create a genuinely missing source and returns its own receipt`, async () => {
    const { vault, fs } = await fixture();
    const content = 'New knowledge.\n';
    const receipt = await fs.writeNoteWithReceipt({ path: 'New.md', mode, content, expectedRevision: 'missing' });
    expect(await readFile(join(vault, 'New.md'), 'utf8')).toBe(content);
    expect(receipt.revision).toBe(hash(content));
  });

  test(`${mode} without a caller guard still preserves an unreadable existing source`, async () => {
    const { vault, fs, writes } = await fixture(async () => {
      throw Object.assign(new Error('Transient unavailable read'), { code: 'EIO' });
    });
    await expect(fs.writeNote({ path: 'Note.md', mode, content: 'Addition only.' })).rejects.toThrow();
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(original);
    expect(writes()).toBe(0);
  });

  test(`${mode} cannot accept a newly created file after the missing guard`, async () => {
    const { vault, fs, writes } = await fixture();
    const exists = fs.noteExists.bind(fs);
    let created = false;
    vi.spyOn(fs, 'noteExists').mockImplementation(async path => {
      const result = await exists(path);
      if (path === 'New.md' && !result && !created) {
        created = true;
        await writeFile(join(vault, path), original);
      }
      return result;
    });
    await expect(fs.writeNoteWithReceipt({ path: 'New.md', mode, content: 'Addition only.', expectedRevision: 'missing' })).rejects.toThrow(/revision conflict/i);
    expect(await readFile(join(vault, 'New.md'), 'utf8')).toBe(original);
    expect(writes()).toBe(0);
  });
}
