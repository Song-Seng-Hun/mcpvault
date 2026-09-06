import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ContinuityService } from './continuity.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture(learning = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-budget-')); vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const service = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  if (learning) {
    await fs.writeNote({ path: 'MOC.md', content: '[[A.md]]\n[[B.md]]', frontmatter: { note_kind: 'moc' } });
    for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry', frontmatter: { note_kind: 'atomic' } });
  }
  const pendingEdits = Array.from({ length: 20 }, (_, i) => ({ path: `Note${i}.md`, expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch', purpose: 'p'.repeat(500) }));
  await service.save({ principal, topic: 'Resume research', summary: 'Useful summary\n'.repeat(200), nextAction: 'Inspect evidence.', cursors: { big: 'c'.repeat(20000), short: 'message-7' }, pendingEdits, ...(learning && { learningProgress: { rootPath: 'MOC.md', completedThrough: 'A.md' } }) });
  const checkpoint = '_scopes/agents/worker/_continuity/work-state.md';
  return { vault, fs, service, principal, checkpoint, pendingEdits };
}

test.each([512, 1200, 6000].flatMap(maxChars => [false, true].map(prettyPrint => ({ maxChars, prettyPrint }))))('resume enforces the entire JSON budget $maxChars (pretty=$prettyPrint)', async ({ maxChars, prettyPrint }) => {
  const { fs, service, principal, checkpoint, pendingEdits } = await fixture();
  const before = await fs.readNote(checkpoint);
  const result = await service.read({ principal, maxChars, prettyPrint } as any);
  expect(JSON.stringify(result, null, prettyPrint ? 2 : undefined).length).toBeLessThanOrEqual(maxChars);
  expect(result).toMatchObject({ exists: true, revision: before.revision, truncated: true });
  expect((result as any).nextAction?.endpointId).toBeTruthy();
  if (result.nextAction?.endpointId === 'mcp.read_note_lines') expect(result.nextAction.arguments.expectedRevision).toBe(before.revision);
  if (maxChars >= 1200) {
    expect(result.fm?.next_action).toBe('Inspect evidence.');
    expect(result.content).toContain('Useful summary');
  }
  for (const item of result.fm?.pending_edits || []) expect(pendingEdits).toContainEqual(item);
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('bounded resume prioritizes a validated learning action over large stored metadata', async () => {
  const { fs, service, principal } = await fixture(true);
  const result = await service.read({ principal, maxChars: 1600, prettyPrint: true } as any);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1600);
  expect(result.learningProgress).toMatchObject({ state: 'ready', canResume: true, next: { path: 'B.md', revision: await fs.readNoteRevision('B.md') } });
});

test('bounded stale resume never reintroduces an unchecked next reading target', async () => {
  const { fs, service, principal } = await fixture(true);
  await fs.writeNote({ path: 'B.md', content: '# Revised entry' });
  const result = await service.read({ principal, maxChars: 1600, prettyPrint: true } as any);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(1600);
  expect(result.learningProgress).toMatchObject({ state: 'stale', canResume: false });
  expect(result.learningProgress.next).toBeUndefined();
});

test.each([NaN, Infinity, -Infinity])('invalid numeric budget %s cannot disable the default cap', async maxChars => {
  const { service, principal } = await fixture();
  const result = await service.read({ principal, maxChars });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
  expect(result.truncated).toBe(true);
});

test('a tiny learning resume withholds an action that cannot fit intact', async () => {
  const { service, principal } = await fixture(true);
  const result = await service.read({ principal, maxChars: 512, prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(512);
  expect(result.learningProgress).toMatchObject({ canResume: false, detailsOmitted: true });
  expect(result.learningProgress.next).toBeUndefined();
  expect(result.nextAction).toMatchObject({ endpointId: 'continuity.resume', arguments: { maxChars: 12000, prettyPrint: false } });
});

test('pulse projection remains unchecked when compacted', async () => {
  const { service, principal } = await fixture(true);
  const result = await service.read({ principal, maxChars: 1200, validateLearningProgress: false });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1200);
  expect(result.learningProgress).toMatchObject({ state: 'saved_unchecked', canResume: false });
  expect(result.learningProgress.next).toBeUndefined();
});

test('MCP pretty resume observes the requested budget and exposes a usable private continuation', async () => {
  const { vault } = await fixture();
  const server = createServer(vault, { version: 'test' });
  const client = new Client({ name: 'resume-budget-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = (endpointId: string, args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    const registered = await call('auth.register', { accountId: 'resume-budget', userId: 'budget-family', modelId: 'codex', agentId: 'resume-budget-agent', password: randomUUID() });
    expect(registered.isError).toBeFalsy();
    const accessToken = JSON.parse((registered.content as any)[0].text).accessToken;
    const saved = await call('continuity.save', { accessToken, topic: 'MCP resume', summary: 'Read the next evidence.', nextAction: 'Inspect evidence.', cursors: { large: 'q'.repeat(20000) } });
    expect(saved.isError, JSON.stringify(saved)).toBeFalsy();
    const result = await call('continuity.resume', { accessToken, maxChars: 1200, prettyPrint: true });
    expect(result.isError).toBeFalsy();
    const text = (result.content as any)[0].text, projection = JSON.parse(text);
    expect(text.length).toBeLessThanOrEqual(1200);
    expect(projection.nextAction.endpointId).toBe('mcp.read_note_lines');
    const more = await call(projection.nextAction.endpointId, { ...projection.nextAction.arguments, accessToken });
    expect(more.isError).toBeFalsy();
    expect(JSON.parse((more.content as any)[0].text).revision).toBe(projection.revision);
    const replaced = await call('continuity.save', { accessToken, topic: 'New checkpoint', summary: 'Different state', nextAction: 'Recheck', expectedRevision: projection.revision });
    expect(replaced.isError, JSON.stringify(replaced)).toBeFalsy();
    const staleMore = await call(projection.nextAction.endpointId, { ...projection.nextAction.arguments, accessToken });
    expect(staleMore.isError).toBe(true);
    expect((staleMore.content as any)[0].text).toMatch(/revision|changed/i);
  } finally { await client.close(); await server.close(); }
});
