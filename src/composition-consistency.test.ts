import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { projectNoteParagraphs, projectNoteOutline, projectNoteHeadingSummary } from './note-projections.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-composition-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content: string, frontmatter: Record<string, unknown> = {}) => fs.writeNote({ path, content,
    frontmatter: { note_kind: 'knowledge', ...frontmatter } });
  return { fs, wiki, write };
}
const claims = 'One claim refers to [[A]]. Another refers to [[B]]. The third is a conclusion.';

test('heading summary preserves exact totals and physical locators while retaining only eight headings', () => {
  const raw = '---\ntitle: Test\n---\n```md\n# Example\n```\n' + Array.from({ length: 2000 }, (_, index) => `## Heading ${index} ###\r\nBody.`).join('\n');
  const all = projectNoteOutline(raw);
  expect(projectNoteHeadingSummary(raw, 8)).toEqual({
    headings: all.slice(0, 8), headingCount: all.length, headingChars: all.reduce((sum, heading) => sum + heading.text.length, 0),
  });
  expect(projectNoteHeadingSummary(raw, 0)).toEqual({ headings: [], headingCount: all.length,
    headingChars: all.reduce((sum, heading) => sum + heading.text.length, 0) });
});

test.each([-1, 1.5, NaN, Infinity])('heading summary rejects invalid retained count %s', limit => {
  expect(() => projectNoteHeadingSummary('# Title', limit)).toThrow(/non-negative integer/);
});

test('composition counts headings beyond the retained prefix for long-body signals', async () => {
  const { wiki, write } = await fixture();
  const body = Array.from({ length: 50 }, (_, index) => `## ${index} ${'x'.repeat(100)}`).join('\n');
  await write('Headings.md', body);
  const result = await wiki.compositionCandidates(undefined, 1.9, 16000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ headingCount: 50, signals: ['many_sections', 'long_body'] });
  expect((result.items[0]!.headingCandidates as unknown[]).length).toBe(8);
  expect(result.items[0]!.proseChars).toBe(projectNoteOutline(body).reduce((sum, heading) => sum + heading.text.length, 0));
});

test('composition ranks every candidate but never sorts a candidate pool larger than the requested limit', async () => {
  const { wiki, write } = await fixture();
  for (let index = 0; index < 45; index++) await write(`Note-${String(index).padStart(2, '0')}.md`, '# One\n## Two\n## Three');
  await write('Z-best.md', '# One\n## Two\n## Three\n' + 'Long prose. '.repeat(400));
  const originalSort = Array.prototype.sort;
  let largestCandidateSort = 0;
  vi.spyOn(Array.prototype, 'sort').mockImplementation(function(this: any[], compare) {
    if (this.length && this.every(item => item && typeof item === 'object' && 'headingCandidates' in item && 'score' in item)) {
      largestCandidateSort = Math.max(largestCandidateSort, this.length);
    }
    return originalSort.call(this, compare);
  });
  const result = await wiki.compositionCandidates(undefined, 3, 16000);
  expect(result.total).toBe(46);
  expect(result.items.map(item => item.path)).toEqual(['Z-best.md', 'Note-00.md', 'Note-01.md']);
  expect(result.truncated).toBe(true);
  expect(largestCandidateSort).toBeLessThanOrEqual(3);
});

test('composition preserves prior stable scan order when distinct Unicode paths collate equally', async () => {
  const { fs, wiki, write } = await fixture();
  const tiedPaths = ['é.md', 'e\u0301.md'];
  expect(tiedPaths[0]!.localeCompare(tiedPaths[1]!)).toBe(0);
  for (const path of tiedPaths) await write(path, '# One\n## Two\n## Three');
  await write('z.md', '# One\n## Two\n## Three\n' + 'Long prose. '.repeat(400));
  const query = fs.queryNotes.bind(fs);
  const scanOrder: string[] = [];
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const page = await query(...args);
    scanOrder.push(...page.notes.map(note => note.path));
    return page;
  });
  const result = await wiki.compositionCandidates(undefined, 2, 16000);
  const firstTie = scanOrder.find(path => tiedPaths.includes(path));
  expect(scanOrder.filter(path => tiedPaths.includes(path))).toHaveLength(2);
  expect(result.items.map(item => item.path)).toEqual(['z.md', firstTie]);
  expect(result.items.every(item => !('scanOrder' in item))).toBe(true);
});

test.each(['```', '~~~~'])('fenced %s examples do not create composition signals', async fence => {
  const { wiki, write } = await fixture();
  await write('Example.md', [fence + 'md', '# One', '## Two', '## Three', '',
    ...Array.from({ length: 15 }, () => claims + '\n'), fence[0] === '`' ? '~~~' : '```',
    '## Still literal', fence + ' not-a-closer', claims, fence, '# Explanation', 'Short explanation.'].join('\n'));
  expect((await wiki.compositionCandidates()).items).toEqual([]);
});

test('a long code sample alone is not evidence that a note has many prose claims', async () => {
  const { wiki, write } = await fixture();
  await write('Code.md', '# Example\n```js\n' + 'const a = 1;\n'.repeat(500) + '```\n');
  expect((await wiki.compositionCandidates()).items).toEqual([]);
});

test('composition locators use physical source lines and the captured revision', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Broad.md', '# Broad\n## First ###\n' + claims + '\n\n## Second\nOther prose.',
    { title: 'Broad', aliases: ['First alias', 'Second alias'] });
  const note = await fs.readNote('Broad.md');
  const result = await wiki.compositionCandidates(undefined, 10, 16000);
  const row: any = result.items[0];
  expect(row.revision).toBe(note.revision);
  expect(row.lineBasis).toBe('physical');
  const lines = note.originalContent.split('\n');
  const heading = row.headingCandidates.find((item: any) => item.heading === 'First');
  expect(heading.line).toBe(lines.indexOf('## First ###') + 1);
  expect(row.paragraphCandidates[0]).toMatchObject({ startLine: lines.indexOf(claims) + 1, endLine: lines.indexOf(claims) + 1 });
  expect(lines.slice(row.paragraphCandidates[0].startLine - 1, row.paragraphCandidates[0].endLine).join('\n')).toBe(claims);
  const preview = await wiki.previewSplit({ path: 'Broad.md', heading: heading.heading });
  expect(preview.range.startLine).toBe(heading.line);
});

test.each([false, true])('a 512-character composition response retains the first inspectable target (pretty=%s)', async prettyPrint => {
  const { wiki, write } = await fixture();
  await write('Broad.md', '# One\n## Two\n## Three', { title: '가'.repeat(20000) });
  const result = await wiki.compositionCandidates(undefined, 10, 512, { prettyPrint });
  expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(512);
  expect(result.items[0]).toMatchObject({ path: 'Broad.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    readAction: { endpointId: 'notes.read', arguments: { path: 'Broad.md' } } });
  expect(result.truncated).toBe(true);
});

test('prose boundaries retain physical lines without merging across code or headings', () => {
  const raw = '---\ntitle: Test\n---\n# Heading\nFirst.\n```\nLiteral.\n```\nSecond.\n## Break\nThird.\nFourth.\n';
  expect([...projectNoteParagraphs(raw)]).toEqual([
    { text: 'First.', startLine: 5, endLine: 5 },
    { text: 'Second.', startLine: 9, endLine: 9 },
    { text: 'Third.\nFourth.', startLine: 11, endLine: 12 },
  ]);
});

test.each(['revised', 'hidden'])('metadata-to-body %s drift is rejected before candidate construction', async change => {
  const { fs, wiki, write } = await fixture();
  await write('Broad.md', '# One\n## Two\n## Three');
  const query = fs.queryNotes.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    if (!changed) { changed = true; await write('Broad.md', 'PRIVATE-MARKER', change === 'hidden' ? { moderation_status: 'hidden' } : {}); }
    return result;
  });
  await expect(wiki.compositionCandidates()).rejects.toThrow(/^A composition source changed or became unavailable; re-read the candidate list and retry\.$/);
});

test('selected sources are revalidated after projection instead of returning old locators', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Broad.md', '# One\n## Two\n## Three');
  const revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async path => {
    await write(path, '# Edited');
    return revision(path);
  });
  await expect(wiki.compositionCandidates()).rejects.toThrow(/composition source changed or became unavailable/);
});

test('private and moderation-hidden notes never enter public candidates or totals', async () => {
  const { wiki, write } = await fixture();
  const body = '# One\n## Two\n## Three';
  await write('Visible.md', body);
  await write('Hidden.md', body, { moderation_status: 'hidden' });
  await write('_scopes/models/codex/Private.md', body);
  const publicResult = await wiki.compositionCandidates(undefined, 10, 16000);
  expect(publicResult.total).toBe(1);
  expect(publicResult.items.map(item => item.path)).toEqual(['Visible.md']);
  const own = await wiki.compositionCandidates({ modelId: 'codex', agentId: 'worker' }, 10, 16000);
  expect(own.total).toBe(2);
  expect(own.items.map(item => item.path)).toContain('scope://model/codex/Private.md');
  expect(JSON.stringify(own)).not.toContain('_scopes/');
});
