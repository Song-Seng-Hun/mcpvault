import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-budget-')); vaults.push(vault);
  const names = ['First', 'Second', 'Third', 'Fourth'];
  await writeFile(join(vault, 'MOC.md'), `---\nllm_wiki_type: knowledge\nnote_kind: moc\n---\n# Course\n${names.map(name => `[[${name}]]`).join('\n')}`);
  for (const name of names) await writeFile(join(vault, `${name}.md`), `---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# ${name}`);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  return { wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)), vault };
}

test.each([1024, 1500, 3000])('learning path honors final pretty JSON budget %i without losing the first reading target', async maxChars => {
  const { wiki } = await fixture();
  const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, maxChars, false, true);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
  expect(result.authoredOrder[0]).toMatchObject({ path: 'First.md', revision: expect.any(String) });
  expect(result.truncated).toBe(true);
});

test('minimal learning previews preserve authored block locators', async () => {
  const { wiki, vault } = await fixture();
  await writeFile(join(vault, 'MOC.md'), '---\nnote_kind: moc\n---\n[[First#^lesson]]\n[[Second]]\n[[Third]]');
  const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 1024);
  expect(result.authoredOrder[0]).toMatchObject({ path: 'First.md', targetBlockId: 'lesson' });
});

test.each([1024, 1500, 3000, 7000, 16000])('both formats keep an exact ordered prefix at %i characters', async maxChars => {
  const { wiki } = await fixture();
  const paths = ['First.md', 'Second.md', 'Third.md', 'Fourth.md'];
  for (const pretty of [false, true]) {
    const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, maxChars, false, pretty);
    expect(JSON.stringify(result, null, pretty ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
    expect(result.authoredOrder.length).toBeGreaterThan(0);
    expect(result.authoredOrder.map((entry: any) => entry.path)).toEqual(paths.slice(0, result.authoredOrder.length));
    expect(result.summary.entries).toBe(4);
  }
});

test('an oversized first identity yields same-position recovery, not a cheaper later target', async () => {
  const { wiki, vault } = await fixture();
  const longPath = 'a'.repeat(240) + '.md';
  await writeFile(join(vault, longPath), '# First');
  await writeFile(join(vault, 'MOC.md'), `---\nnote_kind: moc\n---\n[[${longPath}]]\n[[Second]]`);
  const small: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 1024, false, true);
  expect(small.authoredOrder).toEqual([]);
  expect(small.nextAction).toEqual({ endpointId: 'wiki.learning_path', reuseOriginalArguments: true,
    overrides: { maxChars: 16000, prettyPrint: false } });
  expect(JSON.stringify(small, null, 2).length).toBeLessThanOrEqual(1024);
  const retry: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 16000);
  expect(retry.authoredOrder[0].path).toBe(longPath);
});

test('compact diagnostics retain cycle warnings instead of certifying an unsafe sequence', async () => {
  const { wiki, vault } = await fixture();
  await writeFile(join(vault, 'First.md'), '---\nnote_kind: atomic\ndepends_on: [Second.md]\n---\n# First');
  await writeFile(join(vault, 'Second.md'), '---\nnote_kind: atomic\ndepends_on: [First.md]\n---\n# Second');
  const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 1024, false, true);
  expect(result.authoredOrderConsistent).toBe(false);
  expect(result.summary.dependencyCycles).toBe(1);
  expect(result.detailsOmitted).toBe(true);
});

test('same-query recovery preserves safety flags when a long first identity also has a cycle', async () => {
  const { wiki, vault } = await fixture();
  const longPath = 'a'.repeat(240) + '.md';
  await writeFile(join(vault, longPath), '---\nnote_kind: atomic\ndepends_on: [Second.md]\n---\n# First');
  await writeFile(join(vault, 'Second.md'), `---\nnote_kind: atomic\ndepends_on: [${longPath}]\n---\n# Second`);
  await writeFile(join(vault, 'MOC.md'), `---\nnote_kind: moc\n---\n[[${longPath}]]\n[[Second]]`);
  const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 1024, false, true);
  expect(result.authoredOrder).toEqual([]);
  expect(result.authoredOrderConsistent).toBe(false);
  expect(result.prerequisiteCoverageComplete).toBe(true);
  expect(result.summary.dependencyCycles).toBe(1);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1024);
});

test('public MCP retains learning targets inside the final pretty wire budget', async () => {
  const { vault } = await fixture();
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'learning-budget', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    const response: any = await client.callTool({ name: 'call_endpoint', arguments: {
      endpointId: 'wiki.learning_path', arguments: { path: 'MOC.md', maxDepth: 2, limit: 30, maxChars: 1024, prettyPrint: true },
    } });
    expect(response.isError).not.toBe(true);
    const text = response.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(JSON.parse(text).authoredOrder[0].path).toBe('First.md');
    expect(JSON.parse(text).nextAction.endpointId).toBe('wiki.learning_path');
  } finally { await client.close(); await server.close(); }
});

test('compacted learning path provides an executable same-query recovery for omitted details', async () => {
  const { wiki } = await fixture();
  const result: any = await wiki.learningPath(undefined, 'MOC.md', 2, 30, 1024);
  expect(result.truncated).toBe(true);
  expect(result.nextAction).toEqual({ endpointId: 'wiki.learning_path', reuseOriginalArguments: true,
    overrides: { maxChars: 16000, prettyPrint: false } });
});
