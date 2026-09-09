import { expect, test, vi } from 'vitest';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SearchService } from './search.js';
import { PathFilter } from './pathfilter.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

test.each(['create', 'replace'] as const)('concurrent readers await an active %s index refresh', async operation => {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-refresh-race-';
  const vault = await mkdtemp(join(base, prefix)), path = join(vault, 'Probe.md');
  const search = new SearchService(vault, new PathFilter());
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const pending: Promise<unknown>[] = [];
  try {
    if (operation === 'replace') await writeFile(path, '# Probe\nOldRefreshToken');
    await search.search({ query: 'FreshRefreshToken', canAccessPath: () => true });
    await writeFile(path, '# Probe\nFreshRefreshToken');
    search.invalidate('Probe.md');
    // Delay only the real disk read. Indexing, invalidation, scope filtering and
    // response production remain real; no private production method is mocked.
    vi.mocked(readFile).mockImplementation((async (...args: Parameters<typeof readFile>) => {
      if (args[0] === path) { entered(); await gate; }
      return actual.readFile(...args);
    }) as typeof readFile);
    const first = search.search({ query: 'FreshRefreshToken', canAccessPath: () => true });
    pending.push(first);
    await reading;
    let followerFinished = false;
    const follower = search.search({ query: 'FreshRefreshToken', canAccessPath: () => true })
      .then(result => { followerFinished = true; return result; });
    pending.push(follower);
    // A follower must stay pending while disk admission is deliberately held.
    await delay(30);
    expect(followerFinished).toBe(false);
    release();
    for (const result of await Promise.all([first, follower])) {
      expect(result.map(item => item.p)).toEqual(['Probe.md']);
    }
  } finally {
    release(); await Promise.allSettled(pending);
    vi.mocked(readFile).mockImplementation(actual.readFile);
    await search.close();
    const target = await realpath(vault), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
