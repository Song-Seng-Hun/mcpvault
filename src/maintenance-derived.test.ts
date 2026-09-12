import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { MaintenanceDerivedService } from './maintenance-derived.js';
import { readJsonCanvasMetadata } from './json-canvas.js';
let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService, derived: MaintenanceDerivedService;
const actor = { accountId: 'operator', modelId: 'test', agentId: 'worker', role: 'agent' as const };
const refresh = vi.fn(async () => {});
async function seed(path: string, content: string, noteKind = 'atomic') {
  await fs.writeNote({ path, content, frontmatter: { llm_wiki_type: 'knowledge', note_kind: noteKind, lifecycle: 'evergreen' } });
}
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-derived-adapter-')); fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access)); refresh.mockClear();
  derived = new MaintenanceDerivedService(fs, access, wiki, refresh);
  await seed('Root.md', '# Root\n[[Child]]', 'moc'); await seed('Child.md', '# Child\nInitial evidence.');
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function managed() {
  const preview = await wiki.canvasView(actor, 'Root.md', 'moc', 2, 24, 12000, false);
  const saved = await wiki.writeCanvasView({ ...preview.exportAction.arguments, principal: actor });
  return saved.path;
}

test('unmanaged user Canvas is never an automatic regeneration candidate', async () => {
  await fs.writeCanvasFile({ path: 'Views/User.canvas', content: '{"nodes":[],"edges":[]}', expectedRevision: 'missing' });
  const plan = await derived.inspect('managed_canvas_regenerate', 'Views/User.canvas', actor);
  expect(plan.needed).toBe(false);
  await expect(derived.repair('managed_canvas_regenerate', 'Views/User.canvas', actor, async () => {}, async () => {}, plan)).rejects.toThrow();
  expect(await readFile(join(vault, 'Views/User.canvas'), 'utf8')).toBe('{"nodes":[],"edges":[]}');
});

test('managed stale Canvas replays current export guards after private backup without copying bodies', async () => {
  const path = await managed();
  expect((await derived.inspect('managed_canvas_regenerate', path, actor)).needed).toBe(false);
  const before = await readFile(join(vault, path), 'utf8');
  await seed('Child.md', '# Child\nUPDATED_SOURCE_BODY');
  const plan = await derived.inspect('managed_canvas_regenerate', path, actor); expect(plan.needed).toBe(true);
  let intent: any;
  const result = await derived.repair('managed_canvas_regenerate', path, actor, async () => {}, async captured => {
    expect(await readFile(join(vault, path), 'utf8')).toBe(before); intent = captured;
  }, plan);
  const current = await fs.readCanvasFile(path);
  expect(current.revision).toBe(result.revision); expect(intent.previousRevision).toBe(plan.revision);
  expect(Object.values(readJsonCanvasMetadata(current.document)!.revisions)).toContain((await fs.readNote('Child.md')).revision);
  expect(await readFile(join(vault, path), 'utf8')).not.toContain('UPDATED_SOURCE_BODY');
  expect((await derived.inspect('managed_canvas_regenerate', path, actor)).needed).toBe(false);
});

test.each(['source', 'output', 'revocation', 'backup'])('Canvas repair preserves user data when %s changes at backup admission', async kind => {
  const path = await managed(); await seed('Child.md', '# Child\nChanged evidence.');
  const plan = await derived.inspect('managed_canvas_regenerate', path, actor);
  const before = await readFile(join(vault, path), 'utf8'); let revoked = false;
  await expect(derived.repair('managed_canvas_regenerate', path, actor, async () => { if (revoked) throw new Error('Revoked'); }, async () => {
    if (kind === 'source') await seed('Child.md', '# Child\nLater source.');
    if (kind === 'output') await writeFile(join(vault, path), before + '\n');
    if (kind === 'revocation') revoked = true;
    if (kind === 'backup') throw new Error('Backup unavailable');
  }, plan)).rejects.toThrow();
  expect(await readFile(join(vault, path), 'utf8')).toBe(kind === 'output' ? before + '\n' : before);
});

test('cache refresh is revision-bound and uses only the admitted existing cache callback', async () => {
  const plan = await derived.inspect('cache_refresh', 'Root.md', actor);
  const before = await readFile(join(vault, 'Root.md'), 'utf8');
  await derived.repair('cache_refresh', 'Root.md', actor, async () => {}, async () => { throw new Error('No canonical write expected'); }, plan);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(await readFile(join(vault, 'Root.md'), 'utf8')).toBe(before);
  await seed('Root.md', '# Revised root', 'moc');
  await expect(derived.repair('cache_refresh', 'Root.md', actor, async () => {}, async () => {}, plan)).rejects.toThrow();
  expect(refresh).toHaveBeenCalledTimes(1);
});
