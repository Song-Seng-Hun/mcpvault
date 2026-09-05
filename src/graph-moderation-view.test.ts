import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultGraphIndex } from './vault-graph.js';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';
import * as links from './backlinks.js';
let vault: string;
let graph: VaultGraphIndex;
let server: ReturnType<typeof createServer>;
let client: Client;
const all = () => true;
const hidden = (status = 'hidden') => `---\nmoderation_status: ${status}\naliases: [SecretAlias]\ntags: [private_marker]\n---\n[[Target]] [[MissingSecret]]`;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-graph-moderation-'));
  await mkdir(join(vault, 'Knowledge'));
  await mkdir(join(vault, 'Community/Posts'), { recursive: true });
  await writeFile(join(vault, 'Target.md'), '# Target');
  await writeFile(join(vault, 'Source.md'), '#public_tag\n[[SecretAlias]] [[MissingPublic]] [[asset.png]]');
  await writeFile(join(vault, 'asset.png'), 'attachment');
  await writeFile(join(vault, 'Knowledge/Hidden.md'), hidden());
  await writeFile(join(vault, 'Community/Posts/Hidden.md'), hidden('quarantined'));
  graph = new VaultGraphIndex(vault, new PathFilter(), new FrontmatterHandler());
  server = createServer(vault, { version: 'graph-moderation' });
  client = new Client({ name: 'graph-moderation', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
});
afterEach(async () => { graph.close(); await client.close(); await server.close(); await rm(vault, { recursive: true, force: true }); });
async function call(tool: string, args = {}) {
  const response = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: `mcp.${tool}`, arguments: { maxChars: 3000, ...args } } });
  const text = (response.content as Array<{ text: string }>)[0]!.text;
  expect(text.length).toBeLessThanOrEqual(3000);
  return { response, text, value: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : undefined };
}
test('public tags contain no hidden note contributions', async () => {
  const result = await call('list_all_tags');
  expect(result.value.tags).toEqual([{ tag: 'public_tag', count: 1 }]);
});
test('public unresolved repairs exclude hidden sources and known hidden-only targets', async () => {
  const result = await call('find_unresolved_links', { limit: 1 });
  expect(result.value.total).toBe(1);
  expect(result.text).toContain('MissingPublic');
  expect(result.text).not.toMatch(/MissingSecret|SecretAlias|Hidden/);
});
test('public orphan counts ignore hidden incoming edges before pagination', async () => {
  const result = await call('find_orphan_notes', { limit: 1 });
  expect(result.value.total).toBe(2);
  expect(result.value.orphans[0].path).toBe('Source.md');
  expect(result.text).not.toContain('Hidden');
});
test('outlinks suppress hidden aliases but retain readable attachments and genuine missing links', async () => {
  const result = await call('get_outlinks', { path: 'Source.md' });
  expect(result.value.total).toBe(2);
  expect(result.text).not.toContain('SecretAlias');
  expect(result.text).toContain('asset.png');
});
test.each(['get_backlinks', 'get_outlinks'])('direct graph %s denies hidden sources or targets', async tool => {
  await expect(tool === 'get_backlinks' ? graph.getBacklinks('Knowledge/Hidden.md', 10, all) : graph.getOutlinks('Knowledge/Hidden.md', 10, all)).rejects.toThrow(/Access denied/);
});
test('warm resolver and incoming caches track hide/unhide revisions', async () => {
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(0);
  await writeFile(join(vault, 'Knowledge/Hidden.md'), hidden('visible'));
  graph.invalidate('Knowledge/Hidden.md', 'upsert');
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(1);
  expect((await graph.getOutlinks('Source.md', 10, all)).total).toBe(3);
  await writeFile(join(vault, 'Knowledge/Hidden.md'), hidden());
  graph.invalidate('Knowledge/Hidden.md', 'upsert');
  expect((await graph.getBacklinks('Target.md', 10, all)).total).toBe(0);
  expect((await graph.getOutlinks('Source.md', 10, all)).total).toBe(2);
});
test('unindexed navigation shares the same moderation view', async () => {
  const fs = new FileSystemService(vault);
  expect(await fs.listAllTags()).toEqual([{ tag: 'public_tag', count: 1 }]);
  expect((await fs.findUnresolvedLinks()).total).toBe(1);
  expect((await fs.findOrphanNotes()).orphans.map(n => n.path)).toEqual(['Source.md', 'Target.md']);
  expect((await fs.getOutlinks('Source.md')).total).toBe(2);
  await expect(fs.getOutlinks('Knowledge/Hidden.md')).rejects.toThrow(/Access denied/);
  await expect(fs.getBacklinks('Knowledge/Hidden.md')).rejects.toThrow(/Access denied/);
});

test('backlink excerpts do not reintroduce hidden references through neighboring context', async () => {
  await writeFile(join(vault, 'Source.md'), '# Public [[SecretAlias]]\n[[Target]] then [[SecretAlias]]');
  const result = await call('get_backlinks', { path: 'Target.md' });
  expect(result.value.total).toBe(1);
  expect(result.text).not.toContain('SecretAlias');
  expect(result.text).toContain('then');
});
test('clipped neighboring links cannot expose a hidden target prefix', async () => {
  await writeFile(join(vault, 'Source.md'), `[[Target]] ${'space '.repeat(30)} [[SecretAlias|${'L'.repeat(400)}]]`);
  const result = await call('get_backlinks', { path: 'Target.md' });
  expect(result.value.total).toBe(1);
  expect(result.text).not.toContain('SecretAlias');
});
test('received events bypass stat equality when moderation changes', async () => {
  const path = join(vault, 'Knowledge/Hidden.md');
  const content = (status: string) => `---\nmoderation_status: ${status}\n---\n#stat_tag`;
  const fixed = new Date('2020-01-01T00:00:00Z');
  await writeFile(path, content('normal')); await utimes(path, fixed, fixed);
  expect(await graph.listAllTags(all)).toContainEqual({ tag: 'stat_tag', count: 1 });
  await writeFile(path, content('hidden')); await utimes(path, fixed, fixed);
  graph.invalidate('Knowledge/Hidden.md', 'upsert');
  expect(await graph.listAllTags(all)).not.toContainEqual({ tag: 'stat_tag', count: 1 });
});

test('unindexed backlinks also redact hidden neighboring references', async () => {
  await writeFile(join(vault, 'Source.md'), '[[Target]] then [[SecretAlias]]');
  const result = await new FileSystemService(vault).getBacklinks('Target.md');
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('SecretAlias');
  expect(result.backlinks[0]!.context).toContain('then');
});
test('synthetic Property line numbers do not erase unrelated public Property context', async () => {
  await writeFile(join(vault, 'Source.md'), '---\nsupports: [Target.md]\ndepends_on: [SecretAlias]\n---\n# Source');
  const result = await graph.getOutlinks('Source.md', 10, all);
  expect(result.outlinks).toContainEqual(expect.objectContaining({ propertyPath: 'supports[0]', context: 'supports: Target.md' }));
});

test('dense fingerprint scans reuse one heading parse and one identical context redaction', async () => {
  const heading = 'Public [[SecretAlias]]';
  await writeFile(join(vault, 'Source.md'), `# ${heading}\n[[SecretAlias]] ${Array(600).fill('[[Target]]').join(' ')}`);
  const parseSpy = vi.spyOn(links, 'extractObsidianLinkOccurrences');
  const splitSpy = vi.spyOn(String.prototype, 'split');
  try {
    const result = await graph.getBacklinks('Target.md', 1, all, 0, undefined, true, true);
    const headingParses = parseSpy.mock.calls.filter(([text]) => text === heading).length;
    const redactions = splitSpy.mock.calls.filter(([separator]) => separator === '[[SecretAlias]]').length;
    expect(result.total).toBe(600);
    expect(result.backlinks[0]!.heading).toBe('Public [unavailable link]');
    expect(result.backlinks[0]!.context).toContain('[unavailable link]');
    expect(JSON.stringify(result)).not.toContain('SecretAlias');
    expect(headingParses).toBeLessThanOrEqual(1);
    expect(redactions).toBeLessThanOrEqual(2);
  } finally { parseSpy.mockRestore(); splitSpy.mockRestore(); }
});

test('omitted-context reuse retains each own link instead of copying the first link', async () => {
  await writeFile(join(vault, 'Source.md'), `[[Target#First]] [[Target#Second]] ${'space '.repeat(25)} [[SecretAlias|${'x'.repeat(400)}]]`);
  const result = await graph.getOutlinks('Source.md', 10, all, 0, true, true);
  expect(result.outlinks.map(link => link.context)).toEqual([
    '[context omitted] [[Target#First]]', '[context omitted] [[Target#Second]]',
  ]);
});
