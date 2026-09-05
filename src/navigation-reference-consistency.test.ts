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
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-navigation-reference-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content = '# Note', frontmatter: Record<string, unknown> = {}) => fs.writeNote({ path, content, frontmatter });
  return { fs, wiki, write };
}

test.each(['neighborhood', 'trail'])('%s respects sibling Markdown file identity instead of a remote basename', async mode => {
  const { wiki, write } = await fixture();
  await write('Maps/Root.md', '[base](Base.md)');
  await write('Maps/Base.md'); await write('Other/Base.md');
  if (mode === 'neighborhood') {
    const result = await wiki.neighborhood(undefined, 'Maps/Root.md', 10, 16000);
    expect(result.neighbors.filter(item => item.reasons.includes('direct_link')).map(item => item.path)).toEqual(['Maps/Base.md']);
  } else {
    expect((await wiki.trail(undefined, 'Maps/Root.md', 'Other/Base.md')).paths).toEqual([]);
    expect((await wiki.trail(undefined, 'Maps/Root.md', 'Maps/Base.md')).paths).toHaveLength(1);
  }
});

test.each(['neighborhood', 'trail'])('%s does not invent an edge from a missing Markdown file or ambiguous wikilink', async mode => {
  const { wiki, write } = await fixture();
  await write('Maps/Root.md', '[missing](Missing.md)\n[[Shared]]');
  await write('Other/Missing.md');
  await write('First.md', '# First', { aliases: ['Shared'] });
  await write('Second.md', '# Second', { aliases: ['Shared'] });
  if (mode === 'neighborhood') expect((await wiki.neighborhood(undefined, 'Maps/Root.md', 10, 16000)).neighbors).toEqual([]);
  else for (const path of ['Other/Missing.md', 'First.md', 'Second.md']) expect((await wiki.trail(undefined, 'Maps/Root.md', path)).paths).toEqual([]);
});

test('trail preserves explicit note extensions and does not substitute markdown for md', async () => {
  const { wiki, write } = await fixture();
  await write('Root.md', '[[Target.md]]');
  await write('Target.md'); await write('Target.markdown');
  expect((await wiki.trail(undefined, 'Root.md', 'Target.markdown')).paths).toEqual([]);
  expect((await wiki.trail(undefined, 'Root.md', 'Target.md')).paths).toHaveLength(1);
});

test.each(['neighborhood', 'trail'])('%s respects model-to-agent reference boundaries for a caller owning both', async mode => {
  const { wiki, write } = await fixture();
  const root = '_scopes/models/codex/Root.md', secret = '_scopes/agents/worker/Secret.md';
  await write(root, '[[Secret]]');
  await write(secret, 'PRIVATE-MARKER');
  const principal = { modelId: 'codex', agentId: 'worker' };
  if (mode === 'neighborhood') expect((await wiki.neighborhood(principal, root, 10, 16000)).neighbors).toEqual([]);
  else expect((await wiki.trail(principal, root, secret)).paths).toEqual([]);
});

test.each([512, 1024])('neighborhood obeys maxChars=%s even with long metadata and link context', async budget => {
  const { wiki, write } = await fixture();
  await write('Root.md', '[[A.md]]\n[[B.md]]', { title: 'Root '.repeat(800) });
  await write('A.md', '# A', { title: 'A '.repeat(800) });
  await write('B.md', '# B', { title: 'B '.repeat(800) });
  const result = await wiki.neighborhood(undefined, 'Root.md', 10, budget);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(budget);
  expect(result.source.path).toBe('Root.md');
  expect(result.source.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(result.truncated).toBe(true);
});

test('trail obeys its budget when even one projected edge has long paths and context', async () => {
  const { wiki, write } = await fixture();
  const a = `${'a'.repeat(100)}.md`, b = `${'b'.repeat(100)}.md`;
  await write(a, 'Surrounding '.repeat(30) + `[[${b}]]`);
  await write(b);
  const result = await wiki.trail(undefined, a, b, 2, 3, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.from).toBe(a); expect(result.to).toBe(b);
  expect(result.truncated).toBe(true);
});

test('navigation preserves root-qualified, explicit-relative, embedded, alias and typed Property links', async () => {
  const { wiki, write } = await fixture();
  await write('Maps/Root.md', '[global](Topics/Base.md)\n[local](./Local.markdown)\n![[../Shared.md]]\n[[Preferred alias]]', { supports: ['./Peer.md'] });
  const targets = ['Topics/Base.md', 'Maps/Local.markdown', 'Shared.md', 'Alias.md', 'Maps/Peer.md'];
  for (const target of targets) await write(target, '# Target', target === 'Alias.md' ? { aliases: ['Preferred alias'] } : {});
  await write('Maps/Topics/Base.md');
  const result = await wiki.neighborhood(undefined, 'Maps/Root.md', 10, 16000);
  expect(result.neighbors.filter(item => item.reasons.includes('direct_link')).map(item => item.path).sort()).toEqual([...targets].sort());
  for (const target of targets) {
    expect((await wiki.trail(undefined, 'Maps/Root.md', target)).paths).toHaveLength(1);
    expect((await wiki.neighborhood(undefined, target)).neighbors).toContainEqual(expect.objectContaining({ path: 'Maps/Root.md', reasons: expect.arrayContaining(['backlink']) }));
  }
});

test.each(['neighborhood', 'trail'])('%s refuses a hidden root including a zero-hop trail', async mode => {
  const { wiki, write } = await fixture();
  await write('Root.md', 'PRIVATE-MARKER', { moderation_status: 'hidden', title: 'PRIVATE-MARKER' });
  await expect(mode === 'neighborhood' ? wiki.neighborhood(undefined, 'Root.md') : wiki.trail(undefined, 'Root.md', 'Root.md')).rejects.toThrow(/unavailable/);
});

test('ambiguous wikilinks do not become definite backlinks on either candidate', async () => {
  const { wiki, write } = await fixture();
  await write('First.md', '# First', { aliases: ['Shared'] });
  await write('Second.md', '# Second', { aliases: ['Shared'] });
  await write('Reader.md', '[[Shared]]');
  expect((await wiki.neighborhood(undefined, 'Reader.md')).navigation.ambiguousLinks).toBe(1);
  for (const path of ['First.md', 'Second.md']) expect((await wiki.neighborhood(undefined, path)).neighbors).toEqual([]);
});

test('backlink author filtering does not remove public targets from link resolution', async () => {
  const { wiki, write } = await fixture();
  const root = '_scopes/models/codex/Root.md', reader = '_scopes/models/codex/Reader.md';
  await write(root, '# Root', { aliases: ['Shared'] });
  await write(reader, '[[Shared]]');
  await write('Shared.md');
  const principal = { modelId: 'codex', agentId: 'worker' };
  expect((await wiki.neighborhood(principal, root)).neighbors).toEqual([]);
  await write(root, '# Root', { aliases: ['Unique'] });
  await write(reader, '[[Unique]]');
  expect((await wiki.neighborhood(principal, root)).neighbors).toContainEqual(expect.objectContaining({ path: 'scope://model/codex/Reader.md', reasons: expect.arrayContaining(['backlink']) }));
});
