import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentService } from './document-service.js';
let root: string, service: DocumentService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-chapters-'));
  service = new DocumentService(new DocumentIndex(new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy())));
});
afterEach(async () => { service.index.close(); await rm(root, { recursive: true, force: true }); });

test('chapter outline pages and revision-pinned reads use source bytes, not summaries', async () => {
  const raw = Array.from({ length: 15 }, (_, i) => `# Step ${i}\nOnly if 승인 ${i}.\n\n`).join('');
  await writeFile(join(root, 'manual.md'), raw);
  let outline = await service.outline({ path: 'manual.md', view: 'chapters', limit: 2, maxChars: 2000 });
  const items = [...outline.items];
  while (outline.cursor) {
    outline = await service.outline({ path: 'manual.md', view: 'chapters', expectedRevision: outline.revision as string, cursor: outline.cursor, limit: 2, maxChars: 2000 });
    expect(JSON.stringify(outline).length).toBeLessThanOrEqual(2000);
    items.push(...outline.items);
  }
  expect(items).toHaveLength(15);
  const first = items[0]!;
  const result = await service.read({ path: 'manual.md', chapterId: first.id as string, expectedRevision: outline.revision as string });
  expect(result.parts.map(p => p.text).join('')).toBe(raw.slice(first.startOffset as number, first.endOffset as number));
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  expect(await readFile(join(root, 'manual.md'), 'utf8')).toBe(raw);
  expect(result.context).not.toContain('translation verified');
});

test('chapter selection requires fresh revision and rejects conflicting range controls', async () => {
  await writeFile(join(root, 'manual.md'), '# Topic\nNever overwrite.');
  const outline = await service.outline({ path: 'manual.md', view: 'chapters' });
  const chapterId = outline.items[0]!.id as string;
  await expect(service.read({ path: 'manual.md', chapterId })).rejects.toThrow(/revision/i);
  const args = { path: 'manual.md', chapterId, expectedRevision: outline.revision as string };
  await expect(service.read({ ...args, startLine: 1 })).rejects.toThrow(/chapter|range/i);
  await expect(service.read({ ...args, ranges: [{ startLine: 1 }] })).rejects.toThrow(/chapter|range/i);
  await writeFile(join(root, 'manual.md'), '# Topic\nNever overwrite user edits.');
  await expect(service.read(args)).rejects.toThrow(/stale|revision/i);
});

test('cached chapter metadata does not survive current visibility denial or expose physical paths', async () => {
  await writeFile(join(root, 'manual.md'), '# Topic\nAllowed text.');
  const outline = await service.outline({ path: 'manual.md', view: 'chapters' });
  expect(JSON.stringify(outline)).not.toContain(root);
  await writeFile(join(root, 'manual.md'), '---\nmoderation_status: hidden\n---\n# Secret\nPrivate.');
  await expect(service.outline({ path: 'manual.md', view: 'chapters' })).rejects.toThrow();
  await expect(service.read({ path: 'manual.md', chapterId: outline.items[0]!.id as string, expectedRevision: outline.revision as string })).rejects.toThrow();
});

test('source-reference chapter read retains bounded continuation and exact Unicode coverage', async () => {
  const raw = '~~~\n' + '한😀글\n'.repeat(200) + '~~~\n';
  await writeFile(join(root, 'manual.md'), raw);
  const outline = await service.outline({ path: 'manual.md', view: 'chapters' });
  expect(outline.items[0]!.kind).toBe('source_reference');
  let result = await service.read({ path: 'manual.md', chapterId: outline.items[0]!.id as string, expectedRevision: outline.revision as string, maxChars: 1400 });
  let collected = '';
  for (let calls = 0;; calls++) {
    expect(calls).toBeLessThan(20);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1400);
    collected += result.parts.map(p => p.text).join('');
    if (!result.nextAction) break;
    result = await service.read(result.nextAction.arguments);
  }
  expect(collected).toBe(raw);
});
