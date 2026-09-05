import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture() {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-split-target-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const write = (path: string, content = '# Chosen\nBody\n# Other\nKeep') => fs.writeNote({ path, content });
  return { fs, wiki, write };
}

test('long exact headings are never rewritten into a different ellipsis-named section', async () => {
  const { wiki, write } = await fixture();
  const heading = 'A'.repeat(350), decoy = 'A'.repeat(299) + '…';
  await write('Source.md', `# ${decoy}\nWRONG\n# ${heading}\nRIGHT`);
  const result = await wiki.previewSplit({ path: 'Source.md', heading, maxChars: 4000 });
  expect(result.heading).toBe(heading);
  expect(result.content).toBe(`# ${heading}\nRIGHT`);
  expect(result.range.startLine).toBe(3);
});

const principal = { modelId: 'codex', agentId: 'worker' };
test.each([
  ['_scopes/models/codex/Source.md', '_scopes/agents/worker/Target.md'],
  ['_scopes/agents/worker/Source.md', '_scopes/models/codex/Target.md'],
  ['_scopes/agents/worker/Source.md', 'Target.md'],
  ['Source.md', '_scopes/agents/worker/Target.md'],
])('split from %s to %s cannot broaden content visibility or create a forbidden return link', async (path, targetPath) => {
  const { fs, wiki, write } = await fixture();
  await write(path);
  const exists = vi.spyOn(fs, 'noteExists');
  const result = await wiki.previewSplit({ principal, path, heading: 'Chosen', targetPath });
  expect(result.targetUsable).toBe(false);
  expect(result.collision).toBe('scope_incompatible');
  expect(exists).not.toHaveBeenCalled();
  expect(result.nextSteps.join(' ')).toMatch(/compatible scope/i);
  expect(result.nextSteps.join(' ')).not.toMatch(/Write the complete|Patch the source/);
});

test('a compatible private target returns a reusable public scope identity', async () => {
  const { wiki, write } = await fixture();
  const path = '_scopes/agents/worker/Source.md', targetPath = '_scopes/agents/worker/Target.md';
  await write(path);
  const result = await wiki.previewSplit({ principal, path, heading: 'Chosen', targetPath });
  expect(result.targetPath).toBe('scope://agent/worker/Target.md');
  expect(result.targetUsable).toBe(true);
  expect(result.collision).toBe('none');
  expect(result.nextSteps.join(' ')).toContain('expectedRevision="missing"');
});

test('an existing target does not receive instructions to write or patch the source', async () => {
  const { wiki, write } = await fixture();
  await write('Source.md'); await write('Target.md', '# Preserve this');
  const result = await wiki.previewSplit({ path: 'Source.md', heading: 'Chosen', targetPath: 'Target.md' });
  expect(result.collision).toBe('target_exists');
  expect(result.nextSteps.join(' ')).toMatch(/unused target/i);
  expect(result.nextSteps.join(' ')).not.toMatch(/Write the complete|Patch the source/);
});

test('an unspecified target remains a source preview, not a write instruction', async () => {
  const { wiki, write } = await fixture();
  await write('Source.md');
  const result = await wiki.previewSplit({ path: 'Source.md', heading: 'Chosen' });
  expect(result.content).toBe('# Chosen\nBody');
  expect(result.nextSteps.join(' ')).toContain('targetPath before writing');
  expect(result.nextSteps.join(' ')).not.toMatch(/Write the complete|Patch the source/);
});

test('an inaccessible target neither probes existence nor enables source edits', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Source.md');
  const exists = vi.spyOn(fs, 'noteExists');
  const result = await wiki.previewSplit({ path: 'Source.md', heading: 'Chosen', targetPath: '_scopes/agents/other/Target.md' });
  expect(result.collision).toBe('inaccessible');
  expect(result.targetUsable).toBe(false);
  expect(exists).not.toHaveBeenCalled();
  expect(result.nextSteps.join(' ')).not.toMatch(/Write the complete|Patch the source/);
});

test('a usable public target still requires a missing-revision create and preserves the source', async () => {
  const { fs, wiki, write } = await fixture();
  await write('Source.md');
  const before = await fs.readNote('Source.md');
  const result = await wiki.previewSplit({ path: 'Source.md', heading: 'Chosen', targetPath: 'Target.md' });
  expect(result.targetUsable).toBe(true);
  expect(result.targetExists).toBe(false);
  expect(result.nextSteps.join(' ')).toContain('expectedRevision="missing"');
  expect(result.nextSteps.join(' ')).toContain(before.revision);
  expect((await fs.readNote('Source.md')).revision).toBe(before.revision);
  expect(await fs.noteExists('Target.md')).toBe(false);
  // The preview never reserves a destination; the advised missing guard must
  // still reject another writer creating it before extraction begins.
  await write('Target.md', '# Concurrent target');
  await expect(fs.writeNote({ path: 'Target.md', content: result.content, expectedRevision: 'missing' })).rejects.toThrow();
  expect((await fs.readNote('Target.md')).content).toBe('# Concurrent target');
});

test('compact MCP preview preserves the blocked destination rather than erasing its collision', async () => {
  const { fs, write } = await fixture();
  await write('Source.md', '# Chosen\n' + 'Large content '.repeat(1000));
  await write('Target.md', '# Existing');
  const server = createServer(fs.getVaultPath(), { version: 'split-target-test' });
  const client = new Client({ name: 'split-target-test', version: '1' });
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.split_preview',
      arguments: { path: 'Source.md', heading: 'Chosen', targetPath: 'Target.md', maxChars: 800 } } });
    expect(result.isError).not.toBe(true);
    const text = (result.content as any)[0].text;
    expect(text.length).toBeLessThanOrEqual(800);
    expect(JSON.parse(text)).toMatchObject({ targetPath: 'Target.md', collision: 'target_exists', targetExists: true, truncated: true });
  } finally { await client.close(); await server.close(); }
});
