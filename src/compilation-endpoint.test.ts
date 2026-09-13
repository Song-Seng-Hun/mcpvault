import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../tests/server-fixture.js';
import { parseCliArgs } from './cli.js';
import type { CompilationHost } from './compilation-host.js';
import { getCompilationTools } from './compilation-tools.js';
import { CompilationPublicationAdapter } from './compilation-publication-adapter.js';

let vault: string, client: Client, server: ReturnType<typeof createServer>;
afterEach(async () => { try { await client?.close(); } finally { try { await server?.close(); } finally { vi.restoreAllMocks(); if (vault) await rm(vault, { recursive: true, force: true }); } } });
const parse = (r: any) => JSON.parse(r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''));

test('compilation submission schema exposes pinned preservation reports without granting authority', () => {
  const schema: any = getCompilationTools()[0]!.inputSchema;
  expect(schema.properties.evidence).toBeDefined();
  expect(schema.properties.evidence.properties.facts.maxItems).toBe(32);
  expect(schema.properties.evidence.properties.coverage.maxItems).toBe(128);
  expect(schema.properties).not.toHaveProperty('approved');
  expect(schema.properties.observation.properties.kind.enum).toEqual(['source_only', 'already_covered']);
  expect(schema.properties.observation.properties.coverage.maxItems).toBe(128);
  expect(schema.properties.observation.properties.matches.maxItems).toBe(32);
  expect(schema.properties.includeInspection).toMatchObject({ type: 'boolean' });
  expect(schema.properties.inspectionCursor).toMatchObject({ type: 'integer', minimum: 0 });
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

test.each(['no_host', 'no_runtime', 'read_only'] as const)('host adapter factory is not started for %s', async mode => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-factory-admission-'));
  const factory = vi.fn(() => { throw Error('Factory must not run'); });
  const host = { refresh: async () => { throw Error('Unused host'); } } as any;
  server = createServer(vault, { readOnly: mode === 'read_only', compilation: {
    ...(mode !== 'no_host' && { host }), ...(mode !== 'no_runtime' && {
      runtime: async () => ({ id: 'local', revision: 'v1', local: true, operations: ['index'] as const }),
    }), adapterFactory: factory,
  } });
  expect(factory).not.toHaveBeenCalled();
});

test('explicit host factory connects source-only verification through MCP without publishing a note', async () => {
  vault = await mkdtemp(join(tmpdir(), 'compilation-observation-mcp-'));
  // A trusted host provisions the authoritative policy; compilation must not
  // bootstrap or silently reset an absent/corrupt policy store itself.
  await mkdir(join(vault, '_wiki', '_policies'), { recursive: true });
  await writeFile(join(vault, '_wiki', '_policies', 'documents.md'), '---\ntype: protected-document-policy\nversion: 1\nrules: []\n---\n');
  const body = 'Only approved calls may retry 3 times.', hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const raw = `---\nllm_wiki_type: source\nimmutable: true\ncontent_sha256: ${hash(body)}\n---\n${body}`;
  await writeFile(join(vault, 'Source.md'), raw);
  let history: unknown;
  const host: CompilationHost = {
    refresh: async () => ({ version: 1, enabled: true, accountId: 'operator', projects: [{ id: 'p', ruleVersion: '1',
      sources: [{ path: 'Source.md', classification: 'resolved', mode: 'source_only' }],
      outputPaths: ['Result.md'], runtimeIds: ['local'], operations: ['index'] }] }),
    readState: async () => structuredClone(history), writeState: async state => { history = structuredClone(state); },
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }),
  };
  server = createServer(vault, { compilation: { host,
    runtime: async () => ({ id: 'local', revision: 'verified-1', local: true, operations: ['index'] }),
    adapterFactory: (services: any) => new CompilationPublicationAdapter(services),
  } } as any);
  client = new Client({ name: 'observation-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  const account = parse(await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.register', arguments: {
    accountId: 'operator', modelId: 'codex', userId: 'fixture', agentId: 'worker', password: randomUUID(),
  } } }));
  const call = async (args: Record<string, unknown>) => {
    const value = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.compilation', accessToken: account.accessToken, arguments: args } });
    expect(value.isError, JSON.stringify(value.content)).toBeFalsy(); return parse(value);
  };
  const prepared = await call({ op: 'prepare', requestId: 'one', projectId: 'p', operation: 'index',
    inputs: [{ path: 'Source.md', expectedRevision: hash(raw), role: 'source' }], outputPath: 'Result.md', expectedOutputRevision: 'missing' });
  const submitted = await call({ op: 'submit', requestId: 'one', expectedJobRevision: prepared.jobRevision,
    observation: { kind: 'source_only', reason: 'Source-only policy, no synthesis.', coverage: [{ sourcePath: 'Source.md',
      locator: { revision: hash(raw), startLine: 1, endLine: 1, quoteHash: hash(body) } }] } });
  const done = await call({ op: 'retry', requestId: 'one', expectedJobRevision: submitted.jobRevision });
  expect(done).toMatchObject({ status: 'completed', outcome: 'source_only', wroteOutput: false });
  expect((await readdir(vault)).includes('Result.md')).toBe(false);
  expect((history as any).jobs[0]).not.toHaveProperty('draft');
  const inspection = await call({ op: 'read', requestId: 'one', includeInspection: true, expectedJobRevision: done.jobRevision });
  expect(inspection.inspection.records).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'checkpoint', sourcePath: 'Source.md' })]));
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
  for (const endpointId of ['wiki.exception_board', 'wiki.answer_packet']) {
    const view = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, accessToken: account.accessToken,
      arguments: endpointId === 'wiki.answer_packet' ? { path: 'Source.md', query: 'Restricted', includeSemantic: false, maxChars: 12000 } : { maxChars: 16000 } } });
    expect(view.isError, JSON.stringify(view.content)).toBeFalsy();
    expect(parse(view).compilationReview).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'compilation_check_incomplete', path: 'Source.md' })]));
    expect(JSON.stringify(parse(view))).not.toContain('Restricted draft.');
  }
});
