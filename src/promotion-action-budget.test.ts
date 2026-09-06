import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
async function fixture(kind: 'post' | 'task' | 'legacy' = 'post', id: unknown = 'sample', longPath = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-promotion-action-')); vaults.push(vault);
  const prefix = kind === 'post' ? 'Community/Posts' : kind === 'task' ? 'Community/Tasks' : '_collaboration/discussions';
  const path = `${prefix}/${longPath ? 'long-segment/'.repeat(35) : ''}sample.md`;
  await mkdir(join(vault, path, '..'), { recursive: true });
  const fm = kind === 'post' ? { mcpvault_type: 'blog_post', status: 'published', category: 'research', post_id: id }
    : kind === 'task' ? { mcpvault_type: 'agent_task', status: 'completed', retrospective: 'A useful lesson', task_id: id }
    : { mcpvault_type: 'discussion', status: 'resolved', discussion_id: id };
  await writeFile(join(vault, path), `---\n${JSON.stringify({ ...fm, title: 'Research '.repeat(120) })}\n---\n# Useful experience`);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  return { vault, path, fs, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)) };
}

test.each(['post', 'task'] as const)('%s malformed/mismatched IDs cannot redirect inspection or publication', async kind => {
  for (const id of ['elsewhere', null, '../../escape', 'x'.repeat(200), { bad: true }]) {
    const { wiki, path } = await fixture(kind, id);
    const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
    const item = result.items[0];
    expect(item.promotionPlan.inspect).toEqual({ endpointId: 'notes.read', arguments: { path, maxChars: 7000 } });
    expect(item.identityState).toBe('unverified_metadata_id');
    expect(item.suggestedPath).toBe(`Knowledge/${kind === 'post' ? 'Community' : 'Task Lessons'}/sample.md`);
    for (const action of item.promotionPlan.then) if (action.arguments?.path) expect(action.arguments.path).toBe(item.suggestedPath);
    expect(item).not.toHaveProperty(kind === 'post' ? 'slug' : 'taskId');
  }
});

test.each([512, 800, 1400, 2000, 3000])('promotion final pretty output fits %i characters and retains a recovery action', async maxChars => {
  const { wiki } = await fixture();
  const result: any = await wiki.promotionCandidates(undefined, 10, maxChars, true);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
  expect(result.nextAction || result.items?.[0]?.nextAction || result.items?.[0]?.promotionPlan?.inspect).toBeTruthy();
});

test('oversized legacy inspection returns same-query recovery instead of a dead-end count', async () => {
  const { wiki } = await fixture('legacy', 'sample', true);
  const result: any = await wiki.promotionCandidates(undefined, 10, 512);
  expect(result.nextAction).toEqual({ endpointId: 'wiki.promotion_candidates', reuseOriginalArguments: true,
    overrides: { maxChars: 16000, limit: 1, prettyPrint: false } });
});

test('a report that exactly fills compact JSON budget must also account for pretty formatting', async () => {
  const { wiki } = await fixture();
  const full = await wiki.promotionCandidates(undefined, 10, 16000);
  const maxChars = JSON.stringify(full).length;
  expect(maxChars).toBeLessThan(16000);
  const result = await wiki.promotionCandidates(undefined, 10, maxChars, true);
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
});

test.each(['post', 'task'] as const)('%s verified ID keeps its existing managed read route', async kind => {
  const { wiki } = await fixture(kind);
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  const inspect = result.items[0].promotionPlan.inspect;
  expect(inspect.endpointId).toBe(kind === 'post' ? 'community.post_read' : 'mcp.read_agent_task');
  expect(inspect.arguments[kind === 'post' ? 'slug' : 'taskId']).toBe('sample');
  expect(result.items[0]).not.toHaveProperty('identityState');
});

test('a matching ID in a noncanonical nested file must still inspect that exact file', async () => {
  const { wiki, path } = await fixture('post', 'sample', true);
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].promotionPlan.inspect).toEqual({ endpointId: 'notes.read', arguments: { path, maxChars: 7000 } });
});

test('same-query recovery reopens the long first candidate without skipping', async () => {
  const { wiki, path } = await fixture('legacy', 'sample', true);
  const small: any = await wiki.promotionCandidates(undefined, 10, 512, true);
  expect(JSON.stringify(small, null, 2).length).toBeLessThanOrEqual(512);
  expect(small.nextAction.reuseOriginalArguments).toBe(true);
  const retry: any = await wiki.promotionCandidates(undefined, small.nextAction.overrides.limit,
    small.nextAction.overrides.maxChars, small.nextAction.overrides.prettyPrint);
  expect(retry.items[0].path).toBe(path);
});

test('public MCP fallback action reads the original post, not its forged ID', async () => {
  const { vault, path } = await fixture('post', 'elsewhere');
  await writeFile(join(vault, 'Community/Posts/elsewhere.md'), '# WRONG TARGET');
  const server = createServer(vault, { version: 'test' }), client = new Client({ name: 'promotion-action', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    const call = async (endpointId: string, args: Record<string, unknown>) => {
      const response: any = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
      expect(response.isError).not.toBe(true);
      const text = response.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');
      return { text, value: JSON.parse(text) };
    };
    const result = await call('wiki.promotion_candidates', { maxChars: 512, prettyPrint: true });
    expect(result.text.length).toBeLessThanOrEqual(512);
    const action = result.value.nextAction || result.value.items[0].nextAction;
    expect(action).toEqual({ endpointId: 'notes.read', arguments: { path, maxChars: 7000 } });
    const inspected = await call(action.endpointId, action.arguments);
    expect(inspected.text).toContain('Useful experience');
    expect(inspected.text).not.toContain('WRONG TARGET');
  } finally { await client.close(); await server.close(); }
});

test('record-specific compact inspection retains the identity warning and safe destination', async () => {
  const { wiki } = await fixture('post', 'elsewhere');
  const result: any = await wiki.promotionCandidates(undefined, 10, 512);
  const record = result.items?.[0] || result;
  expect(record.identityState).toBe('unverified_metadata_id');
  expect(record.suggestedPath).toBe('Knowledge/Community/sample.md');
});
