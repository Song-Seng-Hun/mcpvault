import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';

let vault: string, fs: FileSystemService;
beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'provenance-mcp-')); fs = new FileSystemService(vault); });
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });
async function connect(readOnly = false) {
  const server = createServer(vault, { version: 'provenance-test', readOnly });
  const client = new Client({ name: 'provenance-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, any> = {}, accessToken?: string) => {
    const r = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(accessToken && { accessToken }) } });
    const text = (r.content as any[]).map(r => r.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* bounded protocol error */ }
    return { error: r.isError, text, value };
  };
  return { client, call, close: async () => { await client.close(); await server.close(); } };
}
test('authenticated ingestion keeps pinned ancestry; anonymous claim/question reads share the fixed five tools', async () => {
  const c = await connect();
  try {
    expect((await c.client.listTools()).tools).toHaveLength(5);
    const auth = await c.call('auth.register', { accountId: 'provenance-worker', agentId: 'provenance-worker', userId: 'fixture', modelId: 'codex', password: randomUUID() });
    expect(auth.error, auth.text).toBeFalsy(); const token = auth.value.accessToken;
    const ingest = async (id: string, extra: Record<string, unknown> = {}) => {
      const r = await c.call('mcp.ingest_source', { sourceId: id, title: id, content: '재시도는 멱등 요청에만 허용한다.', sourceWorkId: id, ...extra }, token);
      expect(r.error, r.text).toBeFalsy(); return r.value;
    };
    const original = await ingest('original');
    const record = { path: original.path, revision: original.revision, relation: 'quotation' };
    const a = await ingest('first', { sourceDerivations: [record] });
    const b = await ingest('second', { sourceDerivations: [record] });
    expect((await fs.readNote(a.path)).frontmatter.source_derivations).toEqual([record]);
    expect((await c.call('mcp.ingest_source', { title: 'No auth', content: 'No', sourceDerivations: [record] })).error).toBe(true);
    await fs.writeNote({ path: 'Knowledge/Retry.md', content: '# Retry\n\n재시도는 멱등 요청에만 허용한다.', frontmatter: {
      llm_wiki_type: 'knowledge', evidence_paths: [a.path, b.path], claims: [{ id: 'c1', text: '멱등 요청', evidence_paths: [a.path, b.path] }],
    } });
    const matrix = await c.call('wiki.claim_matrix', { path: 'Knowledge/Retry.md', maxChars: 12000 });
    expect(matrix.error, matrix.text).toBeFalsy();
    expect(matrix.value.authoredOrder[0].evidence.provenance.status).toBe('shared_origin_observed');
    const question = await c.call('wiki.answer_packet', { path: 'Knowledge/Retry.md', query: '재시도', includeSemantic: false, maxChars: 12000 });
    expect(question.error, question.text).toBeFalsy(); expect(question.text.length).toBeLessThanOrEqual(12000);
    expect(question.value.provenance.window).toBe('already_loaded_sources_only');
    expect(question.value.provenance.unresolved).toBe(true);
    for (const budget of [1024, 4000]) {
      const bounded = await c.call('wiki.answer_packet', { path: 'Knowledge/Retry.md', query: '재시도', includeSemantic: false, maxChars: budget, prettyPrint: true });
      expect(bounded.error, bounded.text).toBeFalsy(); expect(bounded.text.length).toBeLessThanOrEqual(budget);
    }
  } finally { await c.close(); }
  const readonly = await connect(true);
  try {
    expect((await readonly.call('wiki.claim_matrix', { path: 'Knowledge/Retry.md' })).error).toBeFalsy();
    expect((await readonly.call('mcp.ingest_source', { title: 'No', content: 'No', sourceDerivations: [] })).error).toBe(true);
  } finally { await readonly.close(); }
});
