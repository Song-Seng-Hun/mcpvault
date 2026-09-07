import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { PathFilter } from './pathfilter.js';
import { SearchService } from './search.js';

let vaultPath: string;
let search: SearchService;

beforeEach(async () => {
  vaultPath = await mkdtemp(join(tmpdir(), 'mcpvault-search-access-'));
  search = new SearchService(vaultPath, new PathFilter());
});

afterEach(async () => {
  search.close();
  await rm(vaultPath, { recursive: true, force: true });
});

async function writeNote(path: string, content: string): Promise<void> {
  const fullPath = join(vaultPath, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

describe('SearchService access predicates', () => {
  test('isolates concurrent callers with different predicates and matches an equivalent visible corpus', async () => {
    await writeNote('visible/one.md', '# One\n\nneedle needle visible');
    await writeNote('visible/two.md', '# Two\n\nneedle visible');
    await writeNote('hidden/top.md', '# Top\n\nneedle needle needle hidden');

    const visible = (path: string) => path.startsWith('visible/');
    const hidden = (path: string) => path.startsWith('hidden/');
    const [visibleResults, hiddenResults] = await Promise.all([
      search.search({ query: 'needle', limit: 10, canAccessPath: visible }),
      search.search({ query: 'needle', limit: 10, canAccessPath: hidden }),
    ]);
    const internals = search as unknown as { cache: Map<string, unknown>; inFlight: Map<string, unknown>; corpusStatsCache: Map<string, unknown> };
    expect(internals.cache.size).toBe(0);
    expect(internals.inFlight.size).toBe(0);
    expect(internals.corpusStatsCache.size).toBe(0);
    const equivalentVisibleCorpus = await search.search({ query: 'needle', limit: 10, pathPrefix: 'visible' });

    expect(visibleResults).toEqual(equivalentVisibleCorpus);
    expect(visibleResults.map(result => result.p)).toEqual(['visible/one.md', 'visible/two.md']);
    expect(hiddenResults.map(result => result.p)).toEqual(['hidden/top.md']);
  });

  test('filters hidden top matches before ranking and limit selection', async () => {
    await writeNote('hidden/top.md', '# Top\n\nneedle needle needle needle');
    await writeNote('visible/result.md', '# Result\n\nneedle');

    const results = await search.search({
      query: 'needle',
      limit: 1,
      canAccessPath: path => path.startsWith('visible/'),
    });

    expect(results.map(result => result.p)).toEqual(['visible/result.md']);
  });

  test('checks predicate access linearly for a broad query', async () => {
    const noteCount = 100;
    for (let index = 0; index < noteCount; index += 1) {
      await writeNote(`visible/${index}.md`, `# ${index}\n\ncommon`);
    }
    let predicateCalls = 0;

    const results = await search.search({
      query: 'common',
      limit: 20,
      canAccessPath: path => {
        predicateCalls += 1;
        return path.startsWith('visible/');
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(predicateCalls).toBeLessThanOrEqual(15 * noteCount);
  });

  test('aborts generically when access is revoked during an asynchronous load', async () => {
    await writeNote('visible/revoked.md', '# Revoked\n\nneedle');
    let allowed = true;
    const service = search as unknown as {
      loadText: (document: unknown) => Promise<void>;
    };
    const loadText = service.loadText.bind(search);
    service.loadText = async document => {
      await loadText(document);
      allowed = false;
    };

    await expect(search.search({
      query: 'needle',
      canAccessPath: path => allowed && path.startsWith('visible/'),
    })).rejects.toThrow('Search access changed during search');
  });
});
