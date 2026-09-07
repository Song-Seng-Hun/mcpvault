import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import * as views from './wiki-views.js';

let vault: string;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'wiki-views-')); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function setup(definition: string) {
  await writeFile(join(vault, 'View.md'), `---\nwiki_view:\n${definition}\n---\n# My view\n`);
  return new views.WikiViewService(new FileSystemService(vault), new ScopeAccessPolicy());
}
test('saved views project selected columns with scoped keyset continuation and source revision', async () => {
  const service = await setup('  version: 1\n  filters: {note_kind: atomic}\n  columns: [title]\n  limit: 1');
  await writeFile(join(vault, 'A.md'), '---\nnote_kind: atomic\ntitle: A\nsecret: not projected\n---\nBODY');
  await writeFile(join(vault, 'B.md'), '---\nnote_kind: atomic\ntitle: B\n---\nBODY');
  await mkdir(join(vault, '_scopes/models/claude'), { recursive: true });
  await writeFile(join(vault, '_scopes/models/claude/Hidden.md'), '---\nnote_kind: atomic\ntitle: SECRET\n---\n');
  const first = await service.read(undefined, { path: 'View.md' });
  expect(first.items.map(x => x.path)).toEqual(['A.md']);
  expect(first.items[0]!.properties).toEqual({ title: 'A' });
  expect(JSON.stringify(first)).not.toMatch(/SECRET|not projected|BODY/);
  expect(first.nextAction!.arguments.expectedRevision).toMatch(/^[a-f0-9]{64}$/);
  const second = await service.read(undefined, first.nextAction!.arguments);
  expect(second.items.map(x => x.path)).toEqual(['B.md']);
  await writeFile(join(vault, 'View.md'), '# changed');
  await expect(service.read(undefined, first.nextAction!.arguments)).rejects.toThrow(/revision/i);
});
test('saved views reject scripts, unknown keys and prototype keys instead of evaluating them', async () => {
  for (const definition of ['  version: 1\n  script: process.exit()', '  version: 1\n  filters: {constructor: x}', '  version: 1\n  columns: [__proto__]']) {
    const service = await setup(definition);
    await expect(service.read(undefined, { path: 'View.md' })).rejects.toThrow();
  }
});
test('saved views respect serialized response budget and export the same restricted query as Bases', async () => {
  const service = await setup('  version: 1\n  filters: {note_kind: atomic}\n  columns: [title]\n  sortBy: path\n  sortOrder: desc');
  for (let i = 0; i < 10; i++) await writeFile(join(vault, `${i}.md`), `---\nnote_kind: atomic\ntitle: ${'가'.repeat(4000)}\n---\n`);
  const result = await service.read(undefined, { path: 'View.md', maxChars: 1200 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1200);
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.truncated).toBe(true);
  const base = await service.bases(undefined, { path: 'View.md' });
  expect(base.yaml).toContain('note_kind');
  expect(base.yaml).toContain('direction: DESC');
  expect(base.permissionBoundary).toBe(false);
});
test('hidden rows never enter pagination and directory prefixes do not match sibling names', async () => {
  const service = await setup('  version: 1\n  pathPrefix: Knowledge\n  columns: [title]');
  await mkdir(join(vault, 'Knowledge')); await mkdir(join(vault, 'KnowledgePrivate'));
  await writeFile(join(vault, 'Knowledge/A.md'), '---\nmoderation_status: hidden\ntitle: HIDDEN\n---\n');
  await writeFile(join(vault, 'Knowledge/B.md'), '---\ntitle: Visible\n---\n');
  await writeFile(join(vault, 'KnowledgePrivate/A.md'), '---\ntitle: SIBLING\n---\n');
  const result = await service.read(undefined, { path: 'View.md', prettyPrint: true, maxChars: 1200 });
  expect(result.items.map(row => row.path)).toEqual(['Knowledge/B.md']);
  expect(JSON.stringify(result)).not.toMatch(/HIDDEN|SIBLING/);
  expect((await service.bases(undefined, { path: 'View.md' })).yaml).toContain('Knowledge/');
});
