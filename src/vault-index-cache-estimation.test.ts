import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { VaultMetadataIndex } from './vault-index.js';

test('cyclic YAML sorted reads reject only cache copies, then cache repaired current data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-estimation-'));
  let index: VaultMetadataIndex | undefined;
  try {
    await writeFile(join(root, 'Cycle.md'), '---\nloop: &loop [*loop]\n---\nBody');
    index = new VaultMetadataIndex(root, new PathFilter(), new FrontmatterHandler());
    vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
    let previousRevision = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const rows = await index.listSorted();
      expect(rows.map(row => row.path)).toEqual(['Cycle.md']);
      expect(rows[0]!.frontmatter.loop[0]).toBe(rows[0]!.frontmatter.loop);
      previousRevision = rows[0]!.revision;
      expect((index as any).sortedQueryCache.size).toBe(0);
      expect((index as any).sortedQueryCacheRows).toBe(0);
    }
    await writeFile(join(root, 'Cycle.md'), '---\nloop: repaired\n---\nBody');
    index.invalidate('Cycle.md', 'upsert');
    const repaired = await index.listSorted();
    expect(repaired[0]!.frontmatter.loop).toBe('repaired');
    expect(repaired[0]!.revision).not.toBe(previousRevision);
    expect((index as any).sortedQueryCache.size).toBe(1);
    expect((index as any).sortedQueryCacheRows).toBe(1);
    expect(await index.listSorted()).toBe(repaired);
  } finally {
    await index?.close();
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('mcpvault-estimation-')) {
      throw new Error('Unsafe test cleanup target');
    }
    await rm(target, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
