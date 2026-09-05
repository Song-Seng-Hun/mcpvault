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

async function fixture(content: string) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-moc-reference-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  await fs.writeNote({ path: 'Mocs/Root.md', content, frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  const write = (path: string, extra: Record<string, unknown> = {}) => fs.writeNote({ path, content: '# Basics\nEvidence. ^proof\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', ...extra } });
  return { fs, wiki, write };
}

test.each(['learning', 'health'])('%s projection resolves root-qualified Markdown without a nearer namesake', async mode => {
  const { wiki, write } = await fixture('# Map\n[root](Topics/Base.md#Basics)\n');
  await write('Topics/Base.md');
  await write('Mocs/Topics/Base.md');
  if (mode === 'learning') {
    const result = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 30, 16000);
    expect(result.authoredOrder.map(item => item.path)).toEqual(['Topics/Base.md']);
    expect(result.authoredOrder[0]?.targetHeading).toBe('Basics');
  } else {
    const result = await wiki.graphHealth(undefined, 30, 16000);
    const uncovered = result.mocCoverage.uncoveredKnowledge.items.map(item => item.path);
    expect(uncovered).toContain('Mocs/Topics/Base.md');
    expect(uncovered).not.toContain('Topics/Base.md');
  }
});

test.each(['learning', 'health'])('%s projection never replaces a missing Markdown file with a remote basename or alias', async mode => {
  const { wiki, write } = await fixture('# Map\n[missing](Missing.md)\n[not a file](<Concept alias>)\n');
  await write('Other/Missing.md');
  await write('Other/Concept.md', { aliases: ['Concept alias'] });
  if (mode === 'learning') {
    const result = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 30, 16000);
    expect(result.authoredOrder).toEqual([]);
    expect(result.navigationIssues).toBeDefined();
  } else {
    const result = await wiki.graphHealth(undefined, 30, 16000);
    expect(result.mocCoverage.knowledgeLinkedFromMoc).toBe(0);
  }
});

test('learning paths retain explicit relative files and authored wikilink aliases', async () => {
  const { wiki, write } = await fixture('# Map\n[relative](./Topics/Base.md#^proof)\n[[Concept alias]]\n```md\n[example](Other/Example.md)\n```\n');
  await write('Mocs/Topics/Base.md');
  await write('Other/Concept.md', { aliases: ['Concept alias'] });
  await write('Other/Example.md');
  const result = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 30, 16000);
  expect(result.authoredOrder.map(item => item.path)).toEqual(['Mocs/Topics/Base.md', 'Other/Concept.md']);
  expect(result.authoredOrder[0]?.targetBlockId).toBe('proof');
});

test('nested MOC traversal uses each source folder and stays stable after a root relocation', async () => {
  const { fs, wiki, write } = await fixture('# Map\n[nested](Nested.md)\n');
  await fs.writeNote({ path: 'Mocs/Nested.md', content: '# Nested\n[base](Topics/Base.md)\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  await write('Topics/Base.md');
  await write('Mocs/Topics/Base.md');
  const before = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 30, 16000);
  expect(before.authoredOrder.map(item => item.path)).toEqual(['Mocs/Nested.md', 'Topics/Base.md']);
  const moved = await fs.moveNote({ oldPath: 'Mocs/Root.md', newPath: 'Elsewhere/Root.md', updateLinks: true, expectedRevision: (await fs.readNote('Mocs/Root.md')).revision });
  expect(moved.success).toBe(true);
  const after = await wiki.learningPath(undefined, 'Elsewhere/Root.md', 2, 30, 16000);
  expect(after.authoredOrder.map(item => item.path)).toEqual(before.authoredOrder.map(item => item.path));
});

test('an inaccessible Markdown sibling does not become an accessible alias and small views remain bounded', async () => {
  const { fs, wiki, write } = await fixture('# Map\n[hidden](../_scopes/agents/other/Secret.md)\n[missing sibling](Secret.md)\n');
  await write('_scopes/agents/other/Secret.md', { title: 'PRIVATE MARKER' });
  await write('Other/Substitute.md', { aliases: ['Secret.md'] });
  const result = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 30, 16000);
  expect(result.authoredOrder).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE MARKER');
  const small = await wiki.learningPath(undefined, 'Mocs/Root.md', 2, 1, 1024);
  expect(JSON.stringify(small).length).toBeLessThanOrEqual(1024);
  const health = await wiki.graphHealth(undefined, 30, 16000);
  expect(health.mocCoverage.knowledgeLinkedFromMoc).toBe(0);
  expect(JSON.stringify(health)).not.toContain('PRIVATE MARKER');
  expect((await fs.readNote('Mocs/Root.md')).content).toContain('[missing sibling](Secret.md)');
});
