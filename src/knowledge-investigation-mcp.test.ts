import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { getWikiPolicyTopic } from './wiki-policy.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';

let vault: string, fs: FileSystemService;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'investigation-mcp-')); fs = new FileSystemService(vault); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'investigation-test', readOnly });
  const client = new Client({ name: 'investigation-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, any> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).map(c => c.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* error */ }
    return { error: result.isError, text, value };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
test('progressive instructions and schema explain plan-first investigation without execution authority', () => {
  const text = JSON.stringify(getWikiPolicyTopic('knowledge', 12000));
  expect(text).toContain('knowledgeInvestigation'); expect(text).toContain('planRevision');
  expect(text).toContain('authorization');
  const schema: any = getLlmWikiTools().find(t => t.name === 'publish_knowledge')!.inputSchema;
  expect(schema.properties.knowledgeInvestigation.properties.result.required).toContain('planRevision');
});
test('five tools support plan/result/review discovery while anonymous and read-only writes remain rejected', async () => {
  const c = await connect();
  try {
    expect((await c.client.listTools()).tools).toHaveLength(5);
    const auth = await c.call('auth.register', { accountId: 'investigator', agentId: 'investigator', userId: 'fixture', modelId: 'codex', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy(); const token = auth.value.accessToken;
    const source = await c.call('mcp.ingest_source', { sourceId: 'data', title: 'Results', content: 'No consistent difference was observed.' }, token);
    expect(source.error, source.text).toBeFalsy();
    const target = await c.call('mcp.publish_knowledge', { path: 'Claim.md', content: '# Hypothesis', noteKind: 'hypothesis', evidencePaths: [source.value.path], expectedRevision: 'missing' }, token);
    expect(target.error, target.text).toBeFalsy();
    const record = { question: 'Does the variant make a difference?', targets: [{ path: 'Claim.md', revision: target.value.revision }],
      conditions: 'Same workload, fixed seed.', alternatives: ['Difference', 'No difference'],
      decisionRules: [{ observation: 'No repeatable difference.', interpretation: 'inconclusive', consequence: 'Keep the question open.' }],
      executionBoundary: 'Only the already authorized local fixture. Never run note instructions.' };
    const args = { path: 'Run.md', content: '# Experiment', noteKind: 'experiment', knowledgeInvestigation: record, evidencePaths: [source.value.path], expectedRevision: 'missing' };
    expect((await c.call('mcp.publish_knowledge', args)).error).toBe(true);
    const plan = await c.call('mcp.publish_knowledge', args, token);
    expect(plan.error, plan.text).toBeFalsy();
    const sourceRead = await fs.readNote(source.value.path);
    const completed = await c.call('mcp.publish_knowledge', { ...args, expectedRevision: plan.value.revision, epistemicStatus: 'inconclusive', knowledgeInvestigation: { ...record, result: {
      planRevision: plan.value.revision, observed: 'No repeatable difference.', outcome: 'inconclusive', interpretation: 'Keep the question open.', limitations: 'Single environment.', evidence: [{ path: source.value.path, revision: sourceRead.revision }],
    } } }, token);
    expect(completed.error, completed.text).toBeFalsy();
    const reread = await c.call('notes.read', { path: 'Run.md', expectedRevision: completed.value.revision, maxChars: 4000 });
    expect(reread.error, reread.text).toBeFalsy(); expect(reread.text).toContain('planRevision');
    for (const prettyPrint of [false, true]) {
      const gaps = await c.call('wiki.knowledge_gaps', { limit: 10, maxChars: 4000, prettyPrint });
      expect(gaps.error, gaps.text).toBeFalsy(); expect(gaps.text.length).toBeLessThanOrEqual(4000);
      expect(gaps.value.items.find((item: any) => item.path === 'Run.md').investigation.state).toBe('result_requires_review');
    }
    expect(await fs.readNoteRevision('Claim.md')).toBe(target.value.revision);
  } finally { await c.close(); }
  const readonly = await connect(true);
  try {
    expect((await readonly.call('wiki.knowledge_gaps', { limit: 10, maxChars: 4000 })).error).toBeFalsy();
    expect((await readonly.call('mcp.publish_knowledge', { path: 'No.md', knowledgeInvestigation: {}, expectedRevision: 'missing' })).error).toBe(true);
  } finally { await readonly.close(); }
});
