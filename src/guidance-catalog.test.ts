import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GuidanceCatalog, guidanceSourceRevision, serializeGuidanceNote } from './guidance-catalog.js';
import { guidanceText } from './guidance-runtime.js';
import { VaultFileCatalog } from './vault-catalog.js';
import { PathFilter } from './pathfilter.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'guidance-test-')); roots.push(root);
  const definition = { id: 'guid-test', kind: 'prose' as const, template: 'Read {arg0} before editing.', sources: [{ file: 'src/example.ts', line: 1 }], binding: 'call' as const };
  let enabled = true;
  const catalog = new GuidanceCatalog(root, () => enabled ? { root: '_wiki/Interface', editors: ['editor'] } : undefined, [definition]);
  const path = join(root, catalog.pathFor(definition.id)); await mkdir(join(root, '_wiki/Interface/prose'), { recursive: true });
  return { root, catalog, definition, path, disable: () => { enabled = false; } };
}

test('current validated Vault prose is used without collecting runtime values', async () => {
  const { catalog, definition, path, disable } = await fixture();
  await writeFile(path, serializeGuidanceNote(definition, '{arg0}을 먼저 읽고 수정하세요.'));
  expect(catalog.run(() => guidanceText(definition.id, 'Read Note-A before editing.'))).toBe('Note-A을 먼저 읽고 수정하세요.');
  await writeFile(path, serializeGuidanceNote(definition, '{arg0} 확인 후 수정하세요.'));
  expect(catalog.run(() => guidanceText(definition.id, 'Read Note-A before editing.'))).toBe('Note-A 확인 후 수정하세요.');
  expect(await readFile(path, 'utf8')).not.toContain('Note-A');
  disable();
  expect(catalog.run(() => guidanceText(definition.id, 'Read Note-A before editing.'))).toBe('Read Note-A before editing.');
});

test('invalid placeholders, missing files and source conflicts keep compiled prose', async () => {
  const { catalog, definition, path } = await fixture();
  const get = () => catalog.run(() => guidanceText(definition.id, 'Read Note-A before editing.'));
  expect(get()).toBe('Read Note-A before editing.');
  await writeFile(path, serializeGuidanceNote(definition, '{secret} {arg0}'));
  expect(get()).toBe('Read Note-A before editing.');
  await writeFile(path, serializeGuidanceNote({ ...definition, template: 'Earlier {arg0}' }, 'Earlier change {arg0}'));
  expect(get()).toBe('Read Note-A before editing.');
  expect(catalog.inspect(definition.id).status).toBe('source_conflict');
  expect(() => catalog.validateAmendment(definition.id, '{arg0} reviewed', 'old')).toThrow(/source/i);
  expect(catalog.validateAmendment(definition.id, '{arg0} reviewed', guidanceSourceRevision(definition))).toMatchObject({ guidance_source_revision: guidanceSourceRevision(definition) });
});

test('hidden or excluded guidance falls back; broken host settings cannot break prose or error rendering', async () => {
  const { catalog, definition, path, root } = await fixture();
  await writeFile(path, serializeGuidanceNote(definition, 'Hidden {arg0}').replace('mcpvault_type:', 'moderation_status: hidden\nmcpvault_type:'));
  expect(catalog.run(() => guidanceText(definition.id, 'Read A before editing.'))).toBe('Read A before editing.');
  const broken = new GuidanceCatalog(root, () => { throw new Error('Host config unavailable'); }, [definition]);
  expect(broken.run(() => guidanceText(definition.id, 'Read A before editing.'))).toBe('Read A before editing.');
  const denied = new GuidanceCatalog(root, () => ({ root: '_wiki/Interface', editors: [] }), [definition], () => false);
  expect(denied.run(() => guidanceText(definition.id, 'Read A before editing.'))).toBe('Read A before editing.');
});

test('inventory filters before paging and binds cursors to the visible source catalog', async () => {
  const { root, definition } = await fixture();
  const definitions = Array.from({ length: 4 }, (_, i) => ({ ...definition, id: `guid-item-${i}` }));
  const catalog = new GuidanceCatalog(root, () => ({ root: '_wiki/Interface', editors: [] }), definitions);
  const allowed = (path: string) => !path.includes('item-0');
  const first = catalog.list({ limit: 1, maxChars: 2000 }, allowed);
  expect(JSON.stringify(first)).not.toContain('item-0'); expect(first.truncated).toBe(true);
  const second = catalog.list({ limit: 1, maxChars: 2000, cursor: first.cursor! }, allowed);
  expect(JSON.stringify(second)).toContain('item-2');
  expect(() => catalog.list({ limit: 1, cursor: first.cursor! }, () => false)).toThrow(/changed/);
});

test('interface files are excluded from knowledge inventory but remain explicitly readable', async () => {
  const { root, catalog, path, definition } = await fixture();
  await writeFile(path, serializeGuidanceNote(definition));
  await writeFile(join(root, 'Knowledge.md'), 'Ordinary knowledge');
  const files = new VaultFileCatalog(root, new PathFilter(), p => catalog.isManagedPath(p));
  try {
    expect(await files.listNotePaths()).toEqual(['Knowledge.md']);
    expect((await files.statPaths([catalog.pathFor(definition.id)])).size).toBe(0);
    expect(await readFile(path, 'utf8')).toContain(definition.template);
  } finally { files.close(); }
});

test('source default reads are bounded and revision-safe independently of edited body', async () => {
  const { root, definition } = await fixture();
  const template = 'Long default with important conditions. '.repeat(80);
  const d = { ...definition, template, parts: [template] };
  const catalog = new GuidanceCatalog(root, () => ({ root: '_wiki/Interface', editors: [] }), [d]);
  const result = catalog.list({ sourceId: d.id, maxChars: 512 }, () => true) as any;
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.truncated).toBe(true);
  expect(result.projection).toBe('compiled_default');
  expect(() => catalog.list({ ...result.nextAction.arguments, sourceRevision: 'old' }, () => true)).toThrow(/revision/);
  expect(() => catalog.list({ sourceId: d.id }, () => false)).toThrow(/unavailable/);
});
