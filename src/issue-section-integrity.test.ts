import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture(content: string, frontmatter: Record<string, unknown> = {}) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-issue-section-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const path = '_wiki/issues/example.md';
  await fs.writeNote({ path, content, frontmatter: { llm_wiki_type: 'issue', status: 'open', ...frontmatter } });
  const before = await fs.readNote(path);
  const resolve = (extra: Record<string, unknown> = {}) => wiki.resolveIssue({ path, actor: 'test-agent',
    resolution: 'Fixed the cause.', expectedRevision: before.revision, ...extra });
  return { fs, wiki, path, before, resolve };
}

test.each(['```', '~~~~'])('resolving an issue preserves %s examples and unrelated later sections', async fence => {
  const example = `${fence}md\n## Resolution\nExample only.\n${fence}`;
  const evidence = '## Evidence\n\nKeep [[Source#^proof]].\n### Exact reproduction\nKeep commands.\n';
  const { fs, path, resolve } = await fixture(`# Issue\n\n${example}\n\n## Resolution\n\nOpen.\n\n${evidence}`);
  await resolve({ retrospective: 'Preserve the evidence.' });
  const after = await fs.readNote(path);
  expect(after.content).toContain(example);
  expect(after.content).toContain(evidence.trimEnd());
  expect(after.content).toContain('Fixed the cause.');
  expect(after.frontmatter.status).toBe('resolved');
});

test('a similarly named heading is not a managed resolution section', async () => {
  const prefix = '# Issue\n\n## Resolution alternatives\n\nKeep both proposals.\n';
  const { fs, path, resolve } = await fixture(prefix);
  await resolve();
  expect((await fs.readNote(path)).content.startsWith(prefix)).toBe(true);
});

test('ambiguous real managed sections fail before any body or Properties change', async () => {
  const { fs, path, before, resolve } = await fixture('# Issue\n## Resolution\nFirst\n## Resolution\nSecond');
  await expect(resolve()).rejects.toThrow(/ambiguous.*Resolution/i);
  expect((await fs.readNote(path)).originalContent).toBe(before.originalContent);
});

test('an omitted retrospective preserves authored Markdown instead of reconstructing an old property', async () => {
  const authored = '## Retrospective\n\n- status: captured\nA newer lesson with [[Evidence]].\n\n### Follow-up experiment\nDo not discard this.\n';
  const { fs, path, resolve } = await fixture(`# Issue\n## Resolution\nOpen.\n${authored}\n## Appendix\nKeep appendix.`,
    { issue_retrospective_status: 'captured', issue_retrospective: 'Older compact summary.' });
  await resolve();
  const after = await fs.readNote(path);
  expect(after.content).toContain(authored);
  expect(after.content).toContain('## Appendix\nKeep appendix.');
});

test('retrospective replacement stops before following peer sections', async () => {
  const { fs, path, resolve } = await fixture('# Issue\n## Resolution\nOpen.\n## Retrospective\nOld lesson.\n## Evidence\nPreserve this.');
  await resolve({ retrospective: 'New lesson.' });
  const after = await fs.readNote(path);
  expect(after.content).toContain('New lesson.');
  expect(after.content).not.toContain('Old lesson.');
  expect(after.content).toContain('## Evidence\nPreserve this.');
});

test('an unclosed code fence requires repair rather than writing invisible managed sections', async () => {
  const { fs, path, before, resolve } = await fixture('# Issue\n~~~~md\n## Resolution\nExample only.');
  await expect(resolve()).rejects.toThrow(/unclosed.*fence/i);
  expect((await fs.readNote(path)).originalContent).toBe(before.originalContent);
});

test('status-only retrospective updates preserve current prose even without a compact Property', async () => {
  const { fs, path, resolve } = await fixture('# Issue\n## Resolution\nOpen.\n## Retrospective\n\n- status: captured\nCurrent lesson.\n### Follow-up\nPreserve this.\n## Evidence\nKeep.');
  await resolve({ retrospectiveStatus: 'synthesized' });
  const after = await fs.readNote(path);
  expect(after.content).toContain('- status: synthesized\nCurrent lesson.\n### Follow-up\nPreserve this.');
  expect(after.content).toContain('## Evidence\nKeep.');
  expect(after.frontmatter.issue_retrospective_status).toBe('synthesized');
});

test('a body thematic break and heading closing markers do not shift section edits', async () => {
  const prefix = '---\nIntroductory body.\n\n';
  const { fs, path, resolve } = await fixture(prefix + '## Resolution ###\nOpen.\n## Appendix\nKeep.');
  await resolve();
  const after = await fs.readNote(path);
  expect(after.content.startsWith(prefix)).toBe(true);
  expect(after.content).toContain('## Appendix\nKeep.');
  expect(after.content.match(/^## Resolution$/gm)).toHaveLength(1);
});

test.each(['Fixed.\n## Resolution\nDuplicate', 'Fixed.\n```\nUnclosed'])('invalid caller structure %s is rejected before the write', async resolution => {
  const { fs, path, before, resolve } = await fixture('# Issue\n## Resolution\nOpen.');
  await expect(resolve({ resolution })).rejects.toThrow(/ambiguous|unclosed/i);
  expect((await fs.readNote(path)).originalContent).toBe(before.originalContent);
});

test('a stale revision cannot replace a newer issue body or Properties', async () => {
  const { fs, path, resolve } = await fixture('# Issue\n## Resolution\nOpen.');
  await fs.writeNote({ path, content: '# New issue\n## Resolution\nNewer work.',
    frontmatter: { llm_wiki_type: 'issue', status: 'open', custom: 'preserve' } });
  const current = await fs.readNote(path);
  await expect(resolve()).rejects.toThrow();
  expect((await fs.readNote(path)).originalContent).toBe(current.originalContent);
});

test('replacement fences cannot balance across preserved evidence sections', async () => {
  const { fs, path, before, resolve } = await fixture('# Issue\n## Resolution\nOpen.\n## Evidence\nKeep this proof.\n## Retrospective\nOld lesson.\n## Appendix\nKeep this too.');
  await expect(resolve({ resolution: 'Fixed.\n```', retrospective: '```\nLesson.' })).rejects.toThrow(/unclosed.*fence/i);
  expect((await fs.readNote(path)).originalContent).toBe(before.originalContent);
});
