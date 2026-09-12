import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';

let vault: string;
let server: ReturnType<typeof createServer>;
let client: Client;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-source-comparison-mcp-'));
  server = createServer(vault, { version: 'source-comparison-mcp-test', readOnly: true });
  client = new Client({ name: 'source-comparison-mcp-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  await rm(vault, { recursive: true, force: true });
});

async function note(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), content);
}

function digest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function source(path = '_sources/retry.md', body = '# Retry\n\nRetry only idempotent reads; never payment creation.\n'): Promise<void> {
  await note(path, `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${digest(body)}\n---\n${body}`);
}

async function call(endpointId: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
  const text = (result.content as Array<{ text?: string }>).map(item => item.text || '').join('');
  return { error: result.isError, text, value: result.isError ? undefined : JSON.parse(text) as Record<string, any> };
}

test('keeps the MCP surface at exactly five tools and discovers source comparison', async () => {
  const tools = await client.listTools();
  expect(tools.tools.map(tool => tool.name).sort()).toEqual([
    'call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities',
  ]);

  const found = await client.callTool({ name: 'search_capabilities', arguments: { query: 'source comparison', limit: 3, maxChars: 12000 } });
  const text = (found.content as Array<{ text?: string }>).map(item => item.text || '').join('');
  expect(found.isError, text).toBeFalsy();
  expect(text.toLowerCase()).toContain('wiki.source_compare');
  expect(text.toLowerCase()).toContain('get_wiki_source_comparison');
});

test('compares an immutable source anonymously and returns bounded revision-guarded candidate reads', async () => {
  await source();
  await source('_sources/duplicate.md', '# Retry\n\nA second source snapshot.\n');
  await note('Knowledge/Retry.md', '---\nllm_wiki_type: knowledge\nevidence_paths: ["[[_sources/retry]]"]\n---\n# Retry\n\nRetry only idempotent reads; never payment creation.\n');
  await note('Knowledge/Other.md', '---\nllm_wiki_type: knowledge\n---\n# Other\n\nRetry only when safe.\n');
  const sourceBefore = await readFile(join(vault, '_sources/retry.md'), 'utf8');
  const candidateBefore = await readFile(join(vault, 'Knowledge/Retry.md'), 'utf8');

  const result = await call('wiki.source_compare', { sourcePath: '_sources/retry.md', query: 'Retry' });
  expect(result.error, result.text).toBeFalsy();
  expect(result.value).toMatchObject({ status: 'comparison_ready', source: { path: '_sources/retry.md', integrity: 'verified' } });
  expect(result.value.retrieval.semantic.state).toBe('disabled');
  expect(result.value.worksheet.decisions).toEqual(['already_covered', 'extend_existing', 'conflicting', 'new_knowledge', 'uncertain']);
  expect(result.value.candidates.map((candidate: any) => candidate.path)).not.toContain('_sources/duplicate.md');
  expect(result.value.candidates.map((candidate: any) => candidate.path)).toContain('Knowledge/Retry.md');
  expect(result.text.length).toBeLessThanOrEqual(4000);
  expect(await readFile(join(vault, '_sources/retry.md'), 'utf8')).toBe(sourceBefore);
  expect(await readFile(join(vault, 'Knowledge/Retry.md'), 'utf8')).toBe(candidateBefore);

  const candidate = result.value.candidates.find((item: any) => item.path === 'Knowledge/Retry.md');
  expect(candidate).toMatchObject({ revision: expect.stringMatching(/^[a-f0-9]{64}$/), readAction: { endpointId: expect.any(String) } });
  const followUp = await call(candidate.readAction.endpointId, candidate.readAction.arguments);
  expect(followUp.error, followUp.text).toBeFalsy();
  expect(followUp.value.revision).toBe(candidate.revision);

  await note('Knowledge/Retry.md', '---\nllm_wiki_type: knowledge\n---\n# Retry\n\nCHANGED-CANDIDATE-CANARY\n');
  const staleCandidate = await call(candidate.readAction.endpointId, candidate.readAction.arguments);
  expect(staleCandidate.error).toBe(true);
  expect(staleCandidate.text).not.toContain('Retry only idempotent reads');
  expect(staleCandidate.text).not.toContain('CHANGED-CANDIDATE-CANARY');
});

test('pretty prints and enforces the whole response budget', async () => {
  await source();
  for (let i = 0; i < 20; i++) {
    await note(`Knowledge/Retry-${i}.md`, `---\nllm_wiki_type: knowledge\n---\n# Retry ${i}\n\n${'Retry only when safe. '.repeat(60)}`);
  }
  const result = await call('wiki.source_compare', { sourcePath: '_sources/retry.md', query: 'Retry', includeSemantic: false, maxChars: 2000, prettyPrint: true });
  expect(result.error, result.text).toBeFalsy();
  expect(result.text.length).toBeLessThanOrEqual(2000);
  expect(result.text).toMatch(/^\{\n/);
  expect(result.value.truncated).toBe(true);
});

test('rejects missing, non-source, stale, and out-of-range input without writing', async () => {
  await source();
  for (const args of [{ sourcePath: '_sources/retry.md' }, { query: 'Retry' }, { sourcePath: '_sources/retry.md', query: 'Retry', maxChars: 1999 }, { sourcePath: '_sources/retry.md', query: 'Retry', maxChars: 12001 }]) {
    const result = await call('wiki.source_compare', args);
    expect(result.error, result.text).toBeTruthy();
  }
  await note('Knowledge/NotSource.md', '# Retry\nordinary note');
  const nonSource = await call('wiki.source_compare', { sourcePath: 'Knowledge/NotSource.md', query: 'Retry' });
  expect(nonSource.error).toBe(true);
  expect(nonSource.text).not.toContain('ordinary note');

  const stale = await call('wiki.source_compare', { sourcePath: '_sources/retry.md', query: 'Retry', expectedRevision: '0'.repeat(64) });
  expect(stale.error).toBe(true);
  expect(stale.text).not.toContain('_sources/retry.md');
});

test('rejects private source input without revealing its secret contents', async () => {
  const secret = 'PRIVATE-SOURCE-CANARY-DO-NOT-LEAK';
  await note('_scopes/agents/victim/Private.md', `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${digest(secret)}\n---\n${secret}`);
  const result = await call('wiki.source_compare', { sourcePath: '_scopes/agents/victim/Private.md', query: 'PRIVATE' });
  expect(result.error).toBe(true);
  expect(result.text).not.toContain(secret);
  expect(result.text).not.toContain('victim');
});

test('rejects a source edited after comparison rather than returning mixed revisions', async () => {
  await source();
  await note('Knowledge/Retry.md', '---\nllm_wiki_type: knowledge\n---\n# Retry\n\nRetry only idempotent reads.\n');
  const first = await call('wiki.source_compare', { sourcePath: '_sources/retry.md', query: 'Retry' });
  expect(first.error, first.text).toBeFalsy();
  await source('_sources/retry.md', '# Retry\n\nCHANGED-SOURCE-CANARY\n');
  const second = await call('wiki.source_compare', { sourcePath: '_sources/retry.md', query: 'Retry', expectedRevision: first.value.source.revision });
  expect(second.error).toBe(true);
  expect(second.text).not.toContain('CHANGED-SOURCE-CANARY');
});
