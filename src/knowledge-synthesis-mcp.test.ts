import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { getLlmWikiTools } from './llm-wiki-tools.js';
import { getWikiPolicyTopic } from './wiki-policy.js';

let vault: string, fs: FileSystemService;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'synthesis-mcp-')); fs = new FileSystemService(vault); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'synthesis-test', readOnly });
  const client = new Client({ name: 'synthesis-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, any> = {}, accessToken?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (result.content as any[]).map(c => c.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* protocol error */ }
    return { error: result.isError, text, value };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
test('public guidance teaches the existing conditional synthesis contract without eager handbook expansion', () => {
  const policy = getWikiPolicyTopic('knowledge', 12000);
  expect(policy.rules.join(' ')).toContain('knowledgeSynthesis');
  for (const name of ['publish_knowledge', 'publish_decision_record']) {
    const schema: any = getLlmWikiTools().find(t => t.name === name)!.inputSchema;
    expect(schema.properties.knowledgeSynthesis.properties.inputs.maxItems).toBe(8);
    expect(schema.properties.knowledgeSynthesis.required).toContain('counterexamples');
  }
});
test('five-tool MCP supports conditional publication, bounded candidates and read-only rejection', async () => {
  const c = await connect();
  try {
    expect((await c.client.listTools()).tools).toHaveLength(5);
    const auth = await c.call('auth.register', { accountId: 'synthesis-worker', agentId: 'synthesis-worker', userId: 'fixture', modelId: 'codex', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy(); const token = auth.value.accessToken;
    const captured = await c.call('mcp.ingest_source', { sourceId: 'source', title: 'Observation', content: 'Use the conditions of the original observation.' }, token);
    expect(captured.error, captured.text).toBeFalsy();
    const inputs = [];
    for (const id of ['a', 'b']) {
      const written = await c.call('mcp.publish_knowledge', { path: `${id}.md`, content: `# ${id}`, noteKind: 'atomic', domain: 'cache', evidencePaths: [captured.value.path], expectedRevision: 'missing' }, token);
      expect(written.error, written.text).toBeFalsy(); inputs.push({ id, path: written.value.path, revision: written.value.revision });
    }
    const record = { question: 'Which conditions select which explanation?', inputs,
      explanations: inputs.map(({ id }) => ({ id, explanation: `Option ${id}`, appliesWhen: `Condition ${id}`, limitations: 'No universal claim', basis: [id] })),
      choices: [], counterexamples: [{ description: 'Different conditions give different outcomes.', basis: ['b'] }], unresolvedQuestions: ['Which condition applies here?'] };
    const args = { path: 'Synthesis.md', content: '# Conditional explanation', domain: 'cache', knowledgeSynthesis: record, evidencePaths: [captured.value.path], expectedRevision: 'missing' };
    expect((await c.call('mcp.publish_knowledge', args)).error).toBe(true);
    const result = await c.call('mcp.publish_knowledge', args, token);
    expect(result.error, result.text).toBeFalsy(); expect((await fs.readNote('Synthesis.md')).frontmatter.knowledge_synthesis).toEqual(record);
    for (const maxChars of [768, 4000, 12000]) for (const prettyPrint of [false, true]) {
      const read = await c.call('wiki.synthesis_candidates', { maxChars, prettyPrint });
      expect(read.error, read.text).toBeFalsy(); expect(read.text.length).toBeLessThanOrEqual(maxChars);
      if (maxChars === 12000) expect(read.value.items[0]).toMatchObject({ mode: 'extend_existing_synthesis', synthesisBasis: { state: 'current_revisions' } });
    }
  } finally { await c.close(); }
  const readonly = await connect(true);
  try {
    expect((await readonly.call('wiki.synthesis_candidates', { maxChars: 4000 })).error).toBeFalsy();
    expect((await readonly.call('mcp.publish_knowledge', { path: 'No.md', knowledgeSynthesis: {}, expectedRevision: 'missing' })).error).toBe(true);
  } finally { await readonly.close(); }
});
