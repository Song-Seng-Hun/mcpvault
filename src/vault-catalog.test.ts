import { afterEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathFilter } from './pathfilter.js';
import { VaultFileCatalog } from './vault-catalog.js';

let vaultPath: string | undefined;
let catalog: VaultFileCatalog | undefined;

afterEach(async () => {
  catalog?.close();
  catalog = undefined;
  if (vaultPath) await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
  vaultPath = undefined;
});

async function writeNote(path: string, content: string): Promise<void> {
  const fullPath = join(vaultPath!, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}

describe('VaultFileCatalog', () => {
  test('shares one bounded note inventory and refreshes it after a mutation', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-catalog-'));
    await writeNote('Wiki/one.md', 'one');
    await writeNote('Wiki/two.markdown', 'two');
    await writeNote('.mcpvault/derived.md', 'hidden');
    catalog = new VaultFileCatalog(vaultPath, new PathFilter());

    const [first, second] = await Promise.all([catalog.listNotePaths(), catalog.listNotePaths()]);
    expect(first).toEqual(['Wiki/one.md', 'Wiki/two.markdown']);
    expect(second).toEqual(first);

    await writeNote('Wiki/three.txt', 'three');
    catalog.invalidate('Wiki/three.txt');
    expect(await catalog.listNotePaths()).toEqual(['Wiki/one.md', 'Wiki/three.txt', 'Wiki/two.markdown']);
  });

  test('coalesces duplicate watcher events for the same path', async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-catalog-'));
    await writeNote('Wiki/one.md', 'one');
    catalog = new VaultFileCatalog(vaultPath, new PathFilter());
    const changes: Array<{ path?: string; kind?: string }> = [];
    const unsubscribe = catalog.subscribe((path, kind) => changes.push({ path, kind }));

    (catalog as unknown as { onFilesystemEvent: (filename: string) => void }).onFilesystemEvent('Wiki/one.md');
    (catalog as unknown as { onFilesystemEvent: (filename: string) => void }).onFilesystemEvent('Wiki/one.md');
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(changes).toEqual([{ path: 'Wiki/one.md', kind: 'upsert' }]);
    unsubscribe();
  });
});
