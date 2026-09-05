import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultMetadataIndex } from './vault-index.js';
import { VaultIoCoordinator } from './vault-io.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let vault: string, index: VaultMetadataIndex, fs: FileSystemService, wiki: LlmWikiService;
let reads: string[], afterRead: undefined | ((path: string) => Promise<void>);
const project = (status = 'open', extra = '') => `---\nllm_wiki_type: knowledge\nnote_kind: project\nlifecycle: active\ntask_status: ${status}\nnext_action: Execute the concrete step\n${extra}---\n# Project\n## Brainstorm\n## Project support`;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-work-inventory-'));
  reads = []; afterRead = undefined;
  const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
  index = new VaultMetadataIndex(vault, filter, frontmatter);
  vi.spyOn(index as any, 'startWatcher').mockImplementation(() => undefined);
  const reader = async (path: string) => { reads.push(basename(path)); const raw = await readFile(path, 'utf8'); await afterRead?.(path); return raw; };
  fs = new FileSystemService(vault, filter, frontmatter, undefined, index, undefined,
    new VaultIoCoordinator({ reader, boundedReader: reader }));
  const access = new ScopeAccessPolicy(); wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  await index.list();
});
afterEach(async () => { await index.close(); vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, content: string) { await writeFile(join(vault, path), content); index.invalidate(path, 'upsert'); }

test('work readiness never combines an old satisfied gate with a newly opened dependent across pages', async () => {
  await seed('A-Gate.md', project('completed'));
  await seed('Z-Action.md', project('waiting', 'waiting_for: approval\ndepends_on: ["[[A-Gate]]"]\n'));
  await seed('ZZZ-Independent.md', project());
  for (let n = 0; n < 501; n++) await seed(`Filler-${n}.md`, '# Filler');
  const query = fs.queryNotes.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const page = await query(...args);
    if (!changed) {
      changed = true;
      await seed('A-Gate.md', project('open'));
      await seed('Z-Action.md', project('open', 'depends_on: ["[[A-Gate]]"]\n'));
    }
    return page;
  });
  const result = await wiki.nextActions();
  expect(result.items.some((item: any) => item.path === 'Z-Action.md')).toBe(false);
  expect(result.items.some((item: any) => item.path === 'ZZZ-Independent.md')).toBe(true);
});

test('project planning hydrates current projects only, not ordinary, archived or hidden bodies', async () => {
  await seed('Project.md', project());
  await seed('Ordinary.md', '# unrelated');
  await seed('Archived.md', project().replace('lifecycle: active', 'lifecycle: archived'));
  await seed('Hidden.md', project('open', 'moderation_status: hidden\n'));
  await mkdir(join(vault, '_scopes/models/claude'), { recursive: true });
  await seed('_scopes/models/claude/Private.md', project());
  const result = await wiki.projectPacket();
  expect(reads).toEqual(['Project.md']);
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('Private.md');
  expect(JSON.stringify(result)).not.toContain('Hidden.md');
});

test('project body drift never combines old properties with new headings', async () => {
  await seed('Project.md', project());
  await index.list();
  await writeFile(join(vault, 'Project.md'), project() + '\n## New heading');
  await expect(wiki.projectPacket()).rejects.toThrow(/Query snapshot changed/);
});

test('off-project dependency changes received during project hydration reject the old inventory', async () => {
  await seed('Gate.md', '---\nnote_kind: task\ntask_status: completed\n---\n# Gate');
  await seed('Project.md', project('open', 'depends_on: ["[[Gate]]"]\n'));
  afterRead = async path => {
    if (basename(path) !== 'Project.md') return;
    afterRead = undefined;
    await seed('Gate.md', '---\nnote_kind: task\ntask_status: open\n---\n# Gate');
  };
  await expect(wiki.projectPacket()).rejects.toThrow(/Query snapshot changed/);
});

test.each(['added', 'deleted', 'hidden'])('visible inventory %s during hydration requires a restart', async change => {
  await seed('Project.md', project());
  await seed('Reference.md', '# Reference');
  afterRead = async () => {
    afterRead = undefined;
    if (change === 'added') await seed('New.md', '# New');
    if (change === 'hidden') await seed('Reference.md', '---\nmoderation_status: hidden\n---\n# Reference');
    if (change === 'deleted') { await rm(join(vault, 'Reference.md')); index.invalidate('Reference.md', 'delete'); }
  };
  await expect(wiki.projectPacket()).rejects.toThrow(/Query snapshot changed/);
});

test('another model private change does not invalidate or disclose the visible plan', async () => {
  await seed('Project.md', project());
  await mkdir(join(vault, '_scopes/models/claude'), { recursive: true });
  await seed('_scopes/models/claude/Private.md', '# Private');
  afterRead = async () => { afterRead = undefined; await seed('_scopes/models/claude/Private.md', '# Changed privately'); };
  expect((await wiki.projectPacket()).items).toHaveLength(1);
  expect(reads).toEqual(['Project.md']);
});

test('no-index fallback parses a single inventory without a 500-note cutoff or repeated body reads', async () => {
  await seed('Project.md', project());
  for (let n = 0; n < 502; n++) await seed(`Filler-${n}.md`, '# Filler');
  const reader = async (path: string) => { reads.push(path); return readFile(path, 'utf8'); };
  const fallback = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler(), undefined, undefined, undefined,
    new VaultIoCoordinator({ boundedReader: reader }));
  const notes = await fallback.readQueryInventory(() => true, () => true, note => note.path === 'Project.md');
  expect(notes).toHaveLength(503);
  expect(reads).toHaveLength(503);
  expect(new Set(reads).size).toBe(503);
  expect(notes.filter(note => note.content !== undefined).map(note => note.path)).toEqual(['Project.md']);
});

test('project hydration schedules at most 16 reads before draining the batch', async () => {
  for (let n = 0; n < 35; n++) await seed(`Project-${n}.md`, project());
  let begin!: () => void, release!: () => void, scheduled = 0;
  const beginning = new Promise<void>(resolve => { begin = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const real = (fs as any).hydrateQueryNote.bind(fs);
  const spy = vi.spyOn(fs as any, 'hydrateQueryNote').mockImplementation(async (...args: unknown[]) => {
    scheduled++; begin(); await gate; return real(...args);
  });
  const reading = wiki.projectPacket(); await beginning;
  const initialScheduled = scheduled; release();
  try { expect((await reading).total).toBe(35); expect(initialScheduled).toBe(16); }
  finally { spy.mockRestore(); }
});

test('oversized project sources fail completely with a path-free budget error', async () => {
  await seed('Project.md', project() + 'x'.repeat(MAX_NOTE_CONTENT_BYTES));
  const realFs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler(), undefined, index);
  await expect(realFs.readQueryInventory(() => true, () => true, () => true)).rejects.toThrow('Source exceeds query read budget');
});

test.each([true, false])('planning snapshots retain metadata and section facts, not full bodies (indexed=%s)', async indexed => {
  await seed('Project.md', project() + '\n' + 'body payload '.repeat(10000));
  const targetFs = indexed ? fs : new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  const target = new LlmWikiService(targetFs, access, new ReferenceService(targetFs, access));
  const snapshot = await (target as any).workDependencySnapshot(undefined, true);
  expect(snapshot.notes).toHaveLength(1);
  expect(typeof snapshot.notes[0].content).toBe('undefined');
  expect(snapshot.workNotes[0].revision).toMatch(/^[a-f0-9]{64}$/);
  const packet = await target.projectPacket();
  expect(packet.items[0].planning).toMatchObject({ brainstormSection: true, projectSupport: true });
});

test('changed body revisions are rejected before a content consumer sees them', async () => {
  await seed('Project.md', project()); await index.list();
  await writeFile(join(vault, 'Project.md'), project() + '\nChanged');
  const consume = vi.fn();
  await expect(fs.readQueryInventory(() => true, () => true, () => true, consume)).rejects.toThrow(/Query snapshot changed/);
  expect(consume).not.toHaveBeenCalled();
});

test('metadata changes during consumption still invalidate the entire projection', async () => {
  await seed('Project.md', project());
  const consume = vi.fn(async () => { await seed('New.md', '# New'); });
  await expect(fs.readQueryInventory(() => true, () => true, note => note.path === 'Project.md', consume)).rejects.toThrow(/Query snapshot changed/);
  expect(consume).toHaveBeenCalledTimes(1);
});

test('a failed consumer drains its batch and returns a path-free error', async () => {
  await seed('A.md', project()); await seed('B.md', project());
  let release!: () => void, started!: () => void, failed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const beginning = new Promise<void>(resolve => { started = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  let settled = false;
  const reading = fs.readQueryInventory(() => true, () => true, () => true, async note => {
    if (note.path === 'A.md') { failed(); throw new Error('secret-driver/A.md'); }
    started(); await gate;
  }).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await Promise.all([beginning, failure]);
  await new Promise<void>(resolve => setImmediate(resolve));
  const earlySettlement = settled; release();
  const result = await reading;
  expect(earlySettlement).toBe(false);
  expect(result.message).toBe('Inventory content projection failed; retry the request.');
  const retried = await fs.readQueryInventory(() => true, () => true, () => true, () => undefined);
  expect(retried).toHaveLength(2);
  expect(retried.every(note => note.content === undefined)).toBe(true);
});
