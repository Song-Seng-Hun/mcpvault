import { beforeEach, afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let root: string, client: Client, server: ReturnType<typeof createServer>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wiki-source-change-mcp-'));
  await mkdir(join(root, '_sources'));
  for (const [version, body] of [['old', '# Retry\n\nRetry always.'], ['new', '# Retry\n\nDo not retry payments.']]) {
    await writeFile(join(root, `_sources/${version}.md`), `---\nllm_wiki_type: source\nimmutable: true\nsource_work_id: retry\ncontent_sha256: ${createHash('sha256').update(body).digest('hex')}\n---\n${body}`);
  }
  server = createServer(root, { version: 'source-change-test', readOnly: true });
  client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
});
afterEach(async () => { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); });
async function call(endpointId: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
  const text = (r.content as Array<{ text?: string }>).map(x => x.text || '').join('');
  expect(r.isError, text).toBeFalsy(); return { text, value: JSON.parse(text) };
}
test('selected lineage works anonymously over five-tool MCP and both continuation actions execute', async () => {
  expect((await client.listTools()).tools).toHaveLength(5);
  const { value: r, text } = await call('wiki.source_lineage', { sourcePath: '_sources/new.md', previousSourcePath: '_sources/old.md', prettyPrint: true, maxChars: 4000 });
  expect(r.status).toBe('changed'); expect(text.length).toBeLessThanOrEqual(4000);
  for (const side of [r.delta.hunks[0].old, r.delta.hunks[0].new]) await call(side.readAction.endpointId, side.readAction.arguments);
  await call(r.nextAction.endpointId, r.nextAction.arguments);
});
test('legacy overview and explicit guarded selection coexist', async () => {
  const { value: overview } = await call('wiki.source_lineage', {});
  expect(overview.works[0].editionCount).toBe(2);
  const { value: selected } = await call('wiki.source_lineage', { sourcePath: '_sources/new.md' });
  expect(selected.status).toBe('needs_selection');
  const action = selected.candidates[0].nextAction;
  expect((await call(action.endpointId, action.arguments)).value.status).toBe('changed');
});
