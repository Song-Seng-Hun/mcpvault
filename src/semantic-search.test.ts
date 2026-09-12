import { access, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { PathFilter } from './pathfilter.js';
import { SemanticSearchService } from './semantic-search.js';
import { derivedStorageFixture } from '../tests/derived-storage-fixture.js';

const vaults: string[] = [];

afterEach(async () => {
  await Promise.all(vaults.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('semantic index process lease', () => {
  test('fallback scanning preserves Community prefix for share-shaped roots', async () => {
    const vault=await mkdtemp(join(tmpdir(),'mcpvault-semantic-root-'));vaults.push(vault);
    await mkdir(join(vault,'Community','Skills'),{recursive:true});
    await writeFile(join(vault,'Community','Skills','Method.md'),'# Reference');
    const service=new SemanticSearchService(vault,new PathFilter());
    try {
      (service as any).vaultPath=vault+sep;
      expect(await (service as any).findMarkdownFiles(vault+sep)).toEqual(['Community/Skills/Method.md']);
    } finally { await service.close(); }
  });
  test('close releases the owned lock and permits a standby instance to take over', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mcpvault-semantic-close-'));
    vaults.push(vault);
    const host = await derivedStorageFixture(vault);
    const first = new SemanticSearchService(vault, new PathFilter(), undefined, undefined, undefined, undefined, host.host);
    const second = new SemanticSearchService(vault, new PathFilter(), undefined, undefined, undefined, undefined, host.host);
    const lockPath = join(host.path('semantic-index'), 'worker.lock');
    try {

    expect(await (first as any).acquireIndexLease()).toBe(true);
    expect(await (second as any).acquireIndexLease()).toBe(false);
    await expect(access(lockPath)).resolves.toBeUndefined();

    await first.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await (second as any).acquireIndexLease()).toBe(true);

    await second.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await first.close(); await second.close(); await host.close(); }
  }, 30000);
});
