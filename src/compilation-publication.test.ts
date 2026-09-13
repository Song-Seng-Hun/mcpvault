import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
let vault: string, fs: FileSystemService, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-publication-')); fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy(); wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const body = 'Only approved calls may retry 3 times.';
  await writeFile(join(vault, 'Source.md'), `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(body)}\n---\n${body}`);
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
const params = () => ({ path: 'Result.md', content: 'Only approved calls may retry 3 times.', evidencePaths: ['Source.md'],
  author: 'test-worker', expectedRevision: 'missing' });
const prepare = async (extra = {}) => {
  expect((wiki as any).prepareKnowledgePublication).toBeTypeOf('function');
  return (wiki as any).prepareKnowledgePublication(params(), { timestamp: '2026-09-13T00:00:00.000Z',
    revisionGuards: [{ path: 'Source.md', expectedRevision: await fs.readNoteRevision('Source.md') }], ...extra });
};
test('prepares canonical publication without output write and applies exactly that fingerprint', async () => {
  const first = await prepare(), second = await prepare();
  expect(await fs.noteExists('Result.md')).toBe(false);
  expect(first.fingerprint).toBe(second.fingerprint); expect(first.revision).toBe(hash(first.raw));
  const result = await first.apply(first.fingerprint);
  expect(result.revision).toBe(first.revision); expect((await fs.readNote('Result.md')).originalContent).toBe(first.raw);
});
test('rejects wrong fingerprint before creating output', async () => {
  const prepared = await prepare(); await expect(prepared.apply('0'.repeat(64))).rejects.toThrow();
  expect(await fs.noteExists('Result.md')).toBe(false);
});
test('rejects source drift after preparation', async () => {
  const prepared = await prepare(); await writeFile(join(vault, 'Source.md'), 'Changed original');
  await expect(prepared.apply(prepared.fingerprint)).rejects.toThrow();
  expect(await fs.noteExists('Result.md')).toBe(false);
  const next = await prepare().catch(() => undefined); expect(next).toBeUndefined();
});
test('preserves manual target creation after preparation', async () => {
  const prepared = await prepare();
  await writeFile(join(vault, 'Result.md'), 'Human-authored content.');
  await expect(prepared.apply(prepared.fingerprint)).rejects.toThrow();
  expect((await fs.readNote('Result.md')).content).toBe('Human-authored content.');
});
test('revalidates the host access guard at apply, not only during preparation', async () => {
  let active = true;
  const prepared = await prepare({ assertOutputAccess: async () => { if (!active) throw Error('revoked'); } });
  active = false; await expect(prepared.apply(prepared.fingerprint)).rejects.toThrow();
  expect(await fs.noteExists('Result.md')).toBe(false);
});
