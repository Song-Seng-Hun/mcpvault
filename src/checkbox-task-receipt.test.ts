import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';

const vaults: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
async function fixture(onWrite?: (absolute: string) => void) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-checkbox-receipt-')); vaults.push(vault);
  const fs = new FileSystemService(vault, undefined, undefined, path => { onWrite?.(join(vault, path)); });
  return { vault, fs };
}

test.each(['edited', 'hidden', 'deleted'] as const)('task completion receipt retains its own revision when another editor has %s the file', async race => {
  const original = '- [ ] Review evidence ^review\r\n';
  const written = '- [x] Review evidence ^review\r\n';
  const later = race === 'hidden' ? '---\nmoderation_status: hidden\n---\nPRIVATE FOLLOWUP' : '- [ ] Another editor reopened this ^review\n';
  let captured = '', writes = 0;
  const { vault, fs } = await fixture(path => {
    captured = readFileSync(path, 'utf8'); writes++;
    if (race === 'deleted') unlinkSync(path);
    else writeFileSync(path, later);
  });
  await writeFile(join(vault, 'Tasks.md'), original);
  const receipt = await fs.updateTask({ path: 'Tasks.md', taskId: 'task:block:review', status: 'completed', expectedRevision: hash(original) });
  expect(captured).toBe(written);
  expect(writes).toBe(1);
  expect(receipt).toMatchObject({ success: true, status: 'completed', previousStatus: 'open', taskId: 'task:block:review',
    previousRevision: hash(original), revision: hash(written) });
  expect(JSON.stringify(receipt)).not.toContain('PRIVATE FOLLOWUP');
  if (race === 'deleted') await expect(readFile(join(vault, 'Tasks.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(later);
});

test('no-op receipt uses the inspected revision instead of a later unrelated edit', async () => {
  let writes = 0;
  const { vault, fs } = await fixture(() => { writes++; });
  const original = '- [x] Done ^done\n', later = '- [ ] Reopened ^done\n';
  await writeFile(join(vault, 'Tasks.md'), original);
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementationOnce(async (...args) => {
    const note = await read(...args);
    // Revision validation now hashes without parsing. This is the inspected
    // task snapshot: race after capture, not after an ordinal guard read.
    await writeFile(join(vault, 'Tasks.md'), later);
    return note;
  });
  const receipt = await fs.updateTask({ path: 'Tasks.md', taskId: 'task:block:done', status: 'completed', expectedRevision: hash(original) });
  expect(receipt).toMatchObject({ success: true, previousStatus: 'completed', status: 'completed', previousRevision: hash(original), revision: hash(original) });
  expect(receipt.message).toMatch(/no write was needed/);
  expect(writes).toBe(0);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(later);
});

test('a returned write revision cannot authorize overwriting a subsequent edit', async () => {
  const original = '- [ ] Review ^review\n', later = '- [ ] Edited by somebody else ^review\n';
  let writes = 0;
  const { vault, fs } = await fixture(path => { writes++; writeFileSync(path, later); });
  await writeFile(join(vault, 'Tasks.md'), original);
  const receipt = await fs.updateTask({ path: 'Tasks.md', line: 1, status: 'completed', expectedRevision: hash(original) });
  await expect(fs.updateTask({ path: 'Tasks.md', line: 1, status: 'completed', expectedRevision: receipt.revision! })).rejects.toThrow(/revision conflict/i);
  expect(writes).toBe(1);
  expect(await readFile(join(vault, 'Tasks.md'), 'utf8')).toBe(later);
});
