import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { projectNoteParagraphs } from './note-projections.js';

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
