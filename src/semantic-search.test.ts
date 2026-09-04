import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { PathFilter } from './pathfilter.js';
import { SemanticSearchService } from './semantic-search.js';

const vaults: string[] = [];

afterEach(async () => {
  await Promise.all(vaults.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('semantic index process lease', () => {
  test('close releases the owned lock and permits a standby instance to take over', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'mcpvault-semantic-close-'));
    vaults.push(vault);
    const first = new SemanticSearchService(vault, new PathFilter());
    const second = new SemanticSearchService(vault, new PathFilter());
    const lockPath = join(vault, '.mcpvault', 'semantic-index', 'worker.lock');

    expect(await (first as any).acquireIndexLease()).toBe(true);
    expect(await (second as any).acquireIndexLease()).toBe(false);
    await expect(access(lockPath)).resolves.toBeUndefined();

    await first.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await (second as any).acquireIndexLease()).toBe(true);

    await second.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
