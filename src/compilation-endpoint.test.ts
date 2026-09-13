import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { parseCliArgs } from './cli.js';
import type { CompilationHost } from './compilation-host.js';
import { getCompilationTools } from './compilation-tools.js';

let vault: string, client: Client, server: ReturnType<typeof createServer>;
afterEach(async () => { try { await client?.close(); } finally { try { await server?.close(); } finally { if (vault) await rm(vault, { recursive: true, force: true }); } } });
const parse = (r: any) => JSON.parse(r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));

test('compilation submission schema exposes pinned preservation reports without granting authority', () => {
  const schema: any = getCompilationTools()[0]!.inputSchema;
  expect(schema.properties.evidence).toBeDefined();
  expect(schema.properties.evidence.properties.facts.maxItems).toBe(32);
  expect(schema.properties.evidence.properties.coverage.maxItems).toBe(128);
  expect(schema.properties).not.toHaveProperty('approved');
});

test('compilation is dynamic with public diagnosis, authenticated reads and read-only mutation rejection', async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-endpoint-'));
  server = createServer(vault, { readOnly: true }); client = new Client({ name: 'compilation-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  expect((await client.listTools()).tools).toHaveLength(5);
  const catalog = parse(await client.callTool({ name: 'search_capabilities', arguments: { query: 'wiki.compilation', maxChars: 12000, limit: 1 } }));
  const endpoint = catalog.endpoints.find((e: any) => e.endpointId === 'wiki.compilation');
  expect(endpoint).toBeDefined(); expect(endpoint.mutating).toBe(true);
  expect(endpoint.operations.diagnose.available).toBe(true);
  expect(endpoint.operations.prepare.available).toBe(false);
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.compilation', arguments: { op: 'diagnose', maxChars: 512 } } });
  expect(result.isError).toBeFalsy(); expect(parse(result).status).toBe('diagnostic_only');
  for (const op of ['prepare', 'submit', 'check', 'retry']) {
    const denied = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.compilation', arguments: { op, requestId: 'job' } } });
    expect(denied.isError).toBe(true);
  }
  expect((await readdir(vault)).filter(p => /\.md$/.test(p))).toEqual([]);
});

test('compilation CLI accepts exactly one explicit private configuration, never guesses it from maintenance', () => {
  expect(parseCliArgs(['Vault', '--compilation-config', 'Host/compilation.json'])).toMatchObject({ vaultPathArg: 'Vault', compilationConfig: 'Host/compilation.json' });
  expect(parseCliArgs(['Vault', '--compilation-config=Host/compilation.json'])).toMatchObject({ compilationConfig: 'Host/compilation.json' });
  expect(parseCliArgs(['Vault', '--maintenance-config=Host/maintenance.json'])).not.toHaveProperty('compilationConfig');
  for (const args of [['--compilation-config'], ['--compilation-config='], ['--compilation-config=a', '--compilation-config=b']]) expect(() => parseCliArgs(args)).toThrow();
});

test('actual MCP preparation refreshes its request boundary after inheriting restricted source policy', async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-inheritance-'));
  await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules:\n  - path: Source.md\n    accountIds: [operator]\n---\n');
  const content = '---\nllm_wiki_type: source\n---\nRestricted fixture source.';
  await writeFile(join(vault, 'Source.md'), content);
  let history: unknown;
  const host: CompilationHost = {
    refresh: async () => ({ version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', ruleVersion: '1',
      sources: [{ path: 'Source.md', classification: 'resolved', mode: 'synthesis_allowed' }],
      outputPaths: ['Result.md'], runtimeIds: ['verified'], operations: ['synthesize'] }] }),
    readState: async () => structuredClone(history), writeState: async value => { history = structuredClone(value); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }),
  };
  server = createServer(vault, { compilation: { host, runtime: async () => ({ id: 'verified', revision: '1', local: true, operations: ['synthesize'] }) } });
  client = new Client({ name: 'compilation-inheritance-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  const account = parse(await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
    accountId: 'operator', modelId: 'codex', userId: 'fixture', agentId: 'worker', password: randomUUID(),
  } } }));
  const prepared = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.compilation', accessToken: account.accessToken,
    arguments: { op: 'prepare', requestId: 'one', projectId: 'p', operation: 'synthesize',
      inputs: [{ path: 'Source.md', expectedRevision: createHash('sha256').update(content).digest('hex'), role: 'source' }],
      outputPath: 'Result.md', expectedOutputRevision: 'missing' } } });
  expect(prepared.isError, JSON.stringify(prepared.content)).toBeFalsy();
  expect(parse(prepared).status).toBe('prepared');
  const submitted = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.compilation', accessToken: account.accessToken,
    arguments: { op: 'submit', requestId: 'one', expectedJobRevision: parse(prepared).jobRevision, content: 'Restricted draft.' } } });
  expect(submitted.isError, JSON.stringify(submitted.content)).toBeFalsy();
  expect(parse(submitted).status).toBe('generated');
});
