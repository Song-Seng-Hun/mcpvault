import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { createBenchmarkIntegrity } from './benchmark-host.js';
import type { BenchmarkService } from './benchmark-service.js';
import type { BenchmarkDefinition } from './benchmark-model.js';

let base: string, root: string, client: Client, server: ReturnType<typeof createServer>, token: string;
let service: BenchmarkService, now: Date;
const principalId = 'participant';
async function setup(readOnly = false, configured = true) {
  const source = await new FileSystemService(root).readNote('Problem.md');
  const definition: BenchmarkDefinition = { id: 'demo', lineage: 'demo-problem', version: 'v1', title: 'Demo challenge', problem: 'Find the literal answer.',
    sources: [{ path: 'Problem.md', revision: source.revision }], rubric: [{ id: 'correct', description: 'Literal correctness', minimum: 60 }],
    deadline: '2026-10-01T00:00:00.000Z', allowedTools: [], mode: 'objective', answerKnown: true, grader: { kind: 'exact' }, reward: 0, maxWinners: 1, cap: 0,
    qualityThreshold: 60, participants: [principalId], reviewers: [], allowSameOwnerReview: false };
  server = createServer(root, { readOnly, ...(configured && { benchmarks: {
    enabled: true, definitions: [definition], accountProfiles: async () => ({ [principalId]: { accountId: principalId, ownerId: 'human', modelFamily: 'gpt', approved: true, modelVerified: true } }),
    integrity: createBenchmarkIntegrity(Buffer.alloc(32, 7)), answerReader: async () => 'sealed-secret',
    assertHumanOperator: async (actor: string) => { if (actor !== 'operator') throw Error('Not host operator'); }, now: () => now,
    bindAuthority: (value: BenchmarkService) => { service = value; },
  } }) } as any);
  const [left, right] = InMemoryTransport.createLinkedPair(); client = new Client({ name: 'benchmark-integration', version: '1' });
  await Promise.all([client.connect(left), server.connect(right)]);
}
async function call(endpointId: string, args: Record<string, unknown> = {}, auth = true) {
  const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { ...args, ...(auth && token && { accessToken: token }) } } });
  if (result.isError) throw Error(JSON.stringify(result.content));
  return JSON.parse((result.content[0] as any).text);
}
beforeEach(async () => {
  base = await realpath(tmpdir()); root = await mkdtemp(join(base, 'mcpvault-benchmark-mcp-')); token = ''; now = new Date('2026-09-11T00:00:00Z');
  await new FileSystemService(root).writeNote({ path: 'Problem.md', content: 'A literal answer challenge.', expectedRevision: 'missing' });
});
afterEach(async () => {
  await client?.close(); await server?.close();
  const actual = await realpath(root), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-benchmark-mcp-')) throw Error('Unsafe cleanup');
  await rm(actual, { recursive: true, force: true });
});
async function register() {
  token = (await call('auth.register', { accountId: principalId, agentId: principalId, modelId: 'gpt', userId: 'human', password: 'temporary-benchmark-test-only' }, false)).accessToken;
}
test('fixed five tools share host-opened benchmark service, with sealed submission and no mint by default', async () => {
  await setup(); expect((await client.listTools()).tools).toHaveLength(5); await register();
  await service.open('demo', 'operator', { expectedRevision: 'missing', requestId: 'open' });
  const list = await call('benchmark.list'); expect(list.items).toHaveLength(1);
  const current = await call('benchmark.read', { challengeId: 'demo' });
  const params = { challengeId: 'demo', expectedRevision: current.revision, requestId: 'answer', answer: 'sealed-secret' };
  const submitted = await call('benchmark.submit', params); expect(JSON.stringify(submitted)).not.toContain('sealed-secret');
  await call('auth.logout');
  token = (await call('auth.login', { accountId: principalId, password: 'temporary-benchmark-test-only' }, false)).accessToken;
  expect((await call('benchmark.submit', params)).replay).toBe(true);
  now = new Date('2026-10-02T00:00:00Z');
  const status = await call('benchmark.read', { challengeId: 'demo' });
  const final = await call('benchmark.finalize', { challengeId: 'demo', expectedRevision: status.revision, requestId: 'final' });
  expect(final.state).toBe('decided'); expect(final.route.modelCalls).toBe(0);
  await expect(call('benchmark.open', { challengeId: 'demo' })).rejects.toThrow(/Unknown endpoint/);
});
test('benchmark capability fails closed when absent, unauthenticated or read-only', async () => {
  await setup(true);
  await expect(call('benchmark.submit', { challengeId: 'demo', expectedRevision: 'a'.repeat(64), requestId: 'write', answer: 'x' })).rejects.toThrow(/read.only/i);
  await expect(call('benchmark.list', {}, false)).rejects.toThrow(/login|auth|token|capability|required/i);
  const checked = await call('configuration.check', { kind: 'procedural-bundle', configuration: { id: 'example', version: '1.0.0', nodes: [{ id: 'step', requires: [], excludes: [], cost: 1 }], selected: ['step'] }, maxChars: 512 }, false);
  expect(checked).toMatchObject({ valid: true, executable: false, permissionsGranted: false });
});
test('no configuration means no benchmark authority or automatic startup', async () => {
  await setup(false, false); await register();
  await expect(call('benchmark.list')).rejects.toThrow(/configured|disabled/i);
});
test('idle approved participant receives one optional challenge and hostBusy suppresses it', async () => {
  await setup(); await register(); await service.open('demo', 'operator', { expectedRevision: 'missing', requestId: 'open' });
  const pulse = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 4000 } });
  expect(JSON.parse((pulse.content[0] as any).text).nextAction.tool).toBe('benchmark.read');
  const busy = await client.callTool({ name: 'get_agent_pulse', arguments: { accessToken: token, maxChars: 4000, hostBusy: true } });
  expect(JSON.parse((busy.content[0] as any).text).nextAction.tool).not.toBe('benchmark.read');
});
