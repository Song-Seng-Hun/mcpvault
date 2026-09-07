import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { endpointIdForTool } from './endpoint-registry.js';

let vault: string, fs: FileSystemService;
test('application guidance names the real existing publication endpoint', () => {
  const tool = getLlmWikiTools().find(t => t.name === 'get_wiki_applications')!;
  expect(tool.description).toContain(endpointIdForTool('publish_knowledge'));
  expect(tool.description).not.toContain('wiki.publish');
});
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'wiki-application-mcp-')); fs = new FileSystemService(vault); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'application-test', readOnly });
  const client = new Client({ name: 'application-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, any> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).map(r => r.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* Errors may be plain text. */ }
    return { error: result.isError, text, value };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
async function fixture() {
  await fs.writeNote({ path: 'Knowledge/Retry.md', content: 'Only retry idempotent reads', frontmatter: { llm_wiki_type: 'knowledge' } });
  return { id: 'run-1', knowledge: { path: 'Knowledge/Retry.md', revision: await fs.readNoteRevision('Knowledge/Retry.md') }, environment: 'Windows / Node22', conditions: 'idempotent only', outcome: 'failed', observed: 'Timeout persisted', limitations: 'single run, not a general refutation' };
}
test('five tools, authenticated capture, anonymous bounded applications and revision-safe edits', async () => {
  const record = await fixture(); const c = await connect();
  try {
    expect((await c.client.listTools()).tools).toHaveLength(5);
    const auth = await c.call('auth.register', { accountId: 'application-worker', agentId: 'application-worker', userId: 'fixture', modelId: 'codex', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy(); const token = auth.value.accessToken;
    expect((await c.call('wiki.capture', { content: 'No auth', knowledgeApplications: [record] })).error).toBe(true);
    const captured = await c.call('wiki.capture', { path: 'Inbox/Run.md', content: 'Observed failure', capturedFrom: 'experiment', knowledgeApplications: [record] }, token);
    expect(captured.error, captured.text).toBeFalsy();
    expect((await fs.readNote('Inbox/Run.md')).frontmatter.knowledge_applications).toEqual([record]);
    const read = await c.call('wiki.applications', { path: record.knowledge.path });
    expect(read.error, read.text).toBeFalsy(); expect(read.text.length).toBeLessThanOrEqual(4000);
    expect(read.value.items[0]).toMatchObject({ id: 'run-1', outcome: 'failed', observation: { revision: captured.value.revision } });
    expect((await c.call('wiki.applications', { path: record.knowledge.path, expectedRevision: '0'.repeat(64) })).error).toBe(true);
  } finally { await c.close(); }
});
test('read-only mode exposes applications without allowing capture or task mutation', async () => {
  const record = await fixture(); await fs.writeNote({ path: 'Inbox/Run.md', content: 'Run', frontmatter: { knowledge_applications: [record] } });
  const c = await connect(true);
  try {
    const result = await c.call('wiki.applications', { path: record.knowledge.path });
    expect(result.error, result.text).toBeFalsy(); expect(result.value.items).toHaveLength(1);
    expect((await c.call('wiki.capture', { content: 'No', knowledgeApplications: [record] })).error).toBe(true);
  } finally { await c.close(); }
});
