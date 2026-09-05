import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { VaultFileCatalog } from './vault-catalog.js';

const watches = vi.hoisted(() => ({ changed: undefined as undefined | ((event: string, name?: string) => void) }));
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  watch: (_path: string, _options: unknown, changed: typeof watches.changed) => {
    watches.changed = changed;
    return { on: () => undefined, close: () => undefined, unref: () => undefined };
  },
}));
let vault: string;
let index: VaultMetadataIndex;
let afterRead: undefined | ((path: string, raw: string) => Promise<void>);
const content = (status: string) => `---\nllm_wiki_type: knowledge\nnote_kind: project\nlifecycle: active\ntask_status: ${status}\nnext_action: Perform the prerequisite task\n---\n# Gate`;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-metadata-refresh-'));
  await writeFile(join(vault, 'Gate.md'), content('open'));
  afterRead = undefined;
  index = new VaultMetadataIndex(vault, new PathFilter(), new FrontmatterHandler(), undefined,
    new VaultIoCoordinator({ reader: async path => { const raw = await readFile(path, 'utf8'); await afterRead?.(path, raw); return raw; } }));
  await index.list();
});
afterEach(async () => { await index.close(); vi.restoreAllMocks(); watches.changed = undefined; await rm(vault, { recursive: true, force: true }); });

test('a newer dirty revision received during IO is returned by the same read', async () => {
  await writeFile(join(vault, 'Gate.md'), content('completed'));
  index.invalidate('Gate.md', 'upsert');
  afterRead = async () => {
    afterRead = undefined;
    await writeFile(join(vault, 'Gate.md'), content('open'));
    index.invalidate('Gate.md', 'upsert');
  };
  expect((await index.list())[0]!.frontmatter.task_status).toBe('open');
});

test('an unknown reset during a full refresh discovers its newly added note immediately', async () => {
  await writeFile(join(vault, 'Gate.md'), content('completed'));
  watches.changed!('rename');
  afterRead = async () => {
    afterRead = undefined;
    await writeFile(join(vault, 'Added.md'), '# added');
    watches.changed!('rename');
  };
  expect((await index.list()).map(note => note.path)).toContain('Added.md');
});

test('unknown resets do not trust equal size and mtime', async () => {
  const path = join(vault, 'Gate.md'), fixed = new Date('2020-01-01T00:00:00Z');
  await writeFile(path, content('open')); await utimes(path, fixed, fixed);
  index.invalidate('Gate.md', 'upsert'); await index.list();
  await writeFile(path, content('held')); await utimes(path, fixed, fixed);
  watches.changed!('rename');
  expect((await index.list())[0]!.frontmatter.task_status).toBe('held');
});

test('sustained churn fails boundedly and remains retryable without another event', async () => {
  index.invalidate('Gate.md', 'upsert');
  let reads = 0;
  afterRead = async () => { reads++; index.invalidate('Gate.md', 'upsert'); };
  await expect(index.list()).rejects.toThrow(/changed during refresh.*retry/i);
  expect(reads).toBe(3);
  afterRead = undefined;
  expect((await index.list())[0]!.frontmatter.task_status).toBe('open');
});

test('dirty refresh schedules at most 32 source reads per batch', async () => {
  const paths = Array.from({ length: 70 }, (_, i) => `Note${i}.md`);
  await Promise.all(paths.map(path => writeFile(join(vault, path), '# Note')));
  index.invalidateMany(paths.map(path => ({ path, kind: 'upsert' as const })));
  const real = (index as any).readEntry.bind(index);
  let scheduled = 0, begin!: () => void, release!: () => void;
  const beginning = new Promise<void>(resolve => { begin = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(index as any, 'readEntry').mockImplementation(async (...args: unknown[]) => {
    scheduled++; begin(); await gate; return real(...args);
  });
  const reading = index.list(); await beginning;
  const initialScheduled = scheduled; release();
  try { expect((await reading).length).toBe(71); expect(initialScheduled).toBeLessThanOrEqual(32); }
  finally { spy.mockRestore(); }
});

test('next actions do not treat a prerequisite reopened during refresh as satisfied', async () => {
  await writeFile(join(vault, 'Action.md'), '---\nllm_wiki_type: knowledge\nnote_kind: task\nlifecycle: active\ntask_status: open\nnext_action: Execute the dependent step\ndepends_on: ["[[Gate]]"]\n---\n# Action');
  index.invalidate('Action.md', 'upsert'); await index.list();
  await writeFile(join(vault, 'Gate.md'), content('completed'));
  index.invalidate('Gate.md', 'upsert');
  afterRead = async () => {
    afterRead = undefined;
    await writeFile(join(vault, 'Gate.md'), content('open'));
    index.invalidate('Gate.md', 'upsert');
  };
  const fs = new FileSystemService(vault, undefined, new FrontmatterHandler(), undefined, index);
  const access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const result = await wiki.nextActions(undefined, undefined, 20, 12000);
  expect(result.items.some((item: any) => item.path === 'Action.md')).toBe(false);
});

test('concurrent callers share a dirty refresh and both receive its newer generation', async () => {
  await writeFile(join(vault, 'Gate.md'), content('completed'));
  index.invalidate('Gate.md', 'upsert');
  let reads = 0;
  afterRead = async () => {
    reads++;
    if (reads === 1) {
      await writeFile(join(vault, 'Gate.md'), content('open'));
      index.invalidate('Gate.md', 'upsert');
    }
  };
  const results = await Promise.all(Array.from({ length: 12 }, () => index.list()));
  expect(results.every(rows => rows[0]!.frontmatter.task_status === 'open')).toBe(true);
  expect(reads).toBe(2);
});

test('catalog events received during IO reach metadata before the response', async () => {
  await index.close();
  const filter = new PathFilter(), catalog = new VaultFileCatalog(vault, filter);
  vi.spyOn(catalog as any, 'startWatcher').mockImplementation(() => undefined);
  let change = false;
  index = new VaultMetadataIndex(vault, filter, new FrontmatterHandler(), catalog,
    new VaultIoCoordinator({ reader: async path => {
      const raw = await readFile(path, 'utf8');
      if (change) {
        change = false;
        await writeFile(join(vault, 'Gate.md'), content('open'));
        (catalog as any).onFilesystemEvent('Gate.md');
      }
      return raw;
    } }));
  try {
    await index.list();
    await writeFile(join(vault, 'Gate.md'), content('completed'));
    index.invalidate('Gate.md', 'upsert'); change = true;
    expect((await index.list())[0]!.frontmatter.task_status).toBe('open');
  } finally { catalog.close(); }
});

test('failed batches drain in-flight reads and retain every dirty repair obligation', async () => {
  await writeFile(join(vault, 'Other.md'), content('held'));
  index.invalidateMany(['Gate.md', 'Other.md'].map(path => ({ path, kind: 'upsert' as const })));
  let release!: () => void, started!: () => void, failed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const beginning = new Promise<void>(resolve => { started = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  afterRead = async path => {
    if (path.endsWith('Gate.md')) { failed(); throw new Error('private driver Gate.md'); }
    started(); await gate;
  };
  let settled = false;
  const reading = index.list().then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await Promise.all([beginning, failure]);
  // Cross an event-loop turn with the second reader still explicitly gated.
  await new Promise<void>(resolve => setImmediate(resolve));
  const earlySettlement = settled;
  release();
  const result = await reading;
  expect(earlySettlement).toBe(false);
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toBe('Vault read unavailable; retry after storage access is restored.');
  afterRead = undefined;
  expect((await index.list()).map(note => note.path).sort()).toEqual(['Gate.md', 'Other.md']);
});
