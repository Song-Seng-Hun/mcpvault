import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { withEnterpriseStorageContext } from './enterprise-storage-context.js';
let vault: string, fs: FileSystemService;
const path = 'Views/A.canvas';
const before = JSON.stringify({ nodes: [{ id: 'one', type: 'text', text: 'Before', x: 0, y: 0, width: 200, height: 100 }], edges: [] });
const after = JSON.stringify({ nodes: [], edges: [] });
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-derived-')); fs = new FileSystemService(vault);
  await mkdir(join(vault, 'Views')); await writeFile(join(vault, path), before);
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function params() { return { path, content: after, expectedRevision: (await fs.readCanvasFile(path)).revision }; }

test('private recovery receives exact existing/planned bytes before any derived mutation', async () => {
  let intent: any;
  const result = await fs.writeCanvasFile(await params(), { beforeWrite: async capture => {
    expect(await readFile(join(vault, path), 'utf8')).toBe(before); intent = capture;
  } });
  expect(intent).toMatchObject({ before, after, previousRevision: result.previousRevision, revision: result.revision });
  expect((await fs.readCanvasFile(path)).revision).toBe(result.revision);
});

test('failed private backup prevents a Canvas write', async () => {
  await expect(fs.writeCanvasFile(await params(), { beforeWrite: async () => { throw new Error('Private backup unavailable'); } })).rejects.toThrow();
  expect(await readFile(join(vault, path), 'utf8')).toBe(before);
});

test.each(['edit', 'revocation'])('final derived guard observes %s during asynchronous preparation', async kind => {
  let revoked = false;
  const input = await params();
  await expect(withEnterpriseStorageContext({ access: new ScopeAccessPolicy(), assertFresh: () => {}, beforeWrite: async () => {
    if (kind === 'edit') await writeFile(join(vault, path), before + '\n'); else revoked = true;
  } }, () => fs.writeCanvasFile(input, { assertAccess: async () => { if (revoked) throw new Error('Revoked'); } }))).rejects.toThrow();
  expect(await readFile(join(vault, path), 'utf8')).toBe(kind === 'edit' ? before + '\n' : before);
});
