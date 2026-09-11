import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
let root: string, fs: FileSystemService, access: ScopeAccessPolicy, service: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-duplicates-')); fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const note = (path: string, title: string, extra = '') => writeFile(join(root, path), `---\nllm_wiki_type: knowledge\ntitle: ${title}\n${extra}---\n# ${title}\nDistinct body ${title}`);
test('stable ID is a candidate key even for unrelated titles; discovery is metadata-only', async () => {
  await note('a.md', 'Astronomy', 'stable_id: shared\n'); await note('b.md', 'Cookery', 'stable_id: shared\n');
  for (let i = 0; i < 20; i++) await note(`other${i}.md`, `Unrelated${i}`);
  const query = vi.spyOn(fs, 'queryNotes'), body = vi.spyOn(fs, 'readNote');
  const result = await service.duplicateCandidates();
  expect(result.items[0]).toMatchObject({ source: 'a.md', candidate: 'b.md', reasons: ['same_stable_id'] });
  expect(query.mock.calls.every(([params]) => params.includeContent !== true)).toBe(true);
  expect(body.mock.calls.every(([path, bytes]) => ['a.md', 'b.md'].includes(path) && bytes === 256 * 1024)).toBe(true);
  expect(body.mock.calls.length).toBeLessThanOrEqual(2);
  expect(result).toHaveProperty('completeInventory', false);
});
test('hides candidates and rejects earlier source drift during pair hydration', async () => {
  await note('a.md', 'Shared'); await note('b.md', 'Shared'); await note('hidden.md', 'Shared', 'moderation_status: hidden\n');
  const first = await service.duplicateCandidates();
  expect(JSON.stringify(first)).not.toContain('hidden.md');
  const original = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const value = await original(...args);
    if (args[0] === 'b.md') await note('a.md', 'Secret', 'moderation_status: hidden\n');
    return value;
  });
  await expect(service.duplicateCandidates()).rejects.toThrow(/changed|unavailable|revision/i);
});
test('saturated buckets and hydration windows explicitly remain partial and bounded', async () => {
  for (let i = 0; i < 45; i++) await note(`${String(i).padStart(2, '0')}.md`, 'Shared');
  const body = vi.spyOn(fs, 'readNote');
  const result = await service.duplicateCandidates(undefined, 50, 512);
  expect(result).toHaveProperty('partial', true);
  expect(body.mock.calls.length).toBeLessThanOrEqual(64);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});
