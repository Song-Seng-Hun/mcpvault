import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { startRestApi } from './rest-api.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService } from './scope-auth.js';
import { SkillEvolutionService, type SkillEvolutionHost } from './skill-evolution.js';
import { projectSkill, previewSkills, applySkills } from './skill-library.js';

const cleanups: Array<() => Promise<unknown>> = [];
vi.setConfig({ testTimeout: 30000 });
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture(readOnly = false) {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-evolution-mcp-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fs = new FileSystemService(root), auth = new ScopeAuthService(root);
  const registration = await auth.register({ accountId: 'worker', modelId: 'test', password: 'synthetic-password-only' });
  const notes = projectSkill({ id: 'safe-edit', origin: 'fixture', version: '1', license: 'MIT', licenseText: 'MIT License\nPermission is hereby granted, free of charge',
    description: 'editCurrentMarker', files: [{ path: 'SKILL.md', text: '# editCurrentMarker\nread\npatch\n' }], unavailable: [] });
  await applySkills(fs, notes, (await previewSkills(fs, notes)).fingerprint);
  await fs.writeNote({ path: 'Evidence/edit.md', content: 'A missing verification was observed.' });
  const evidence = { path: 'Evidence/edit.md', revision: (await fs.readNote('Evidence/edit.md')).revision };
  const host: SkillEvolutionHost = { enabled: true, attestationKey: 'synthetic-only-private-key-1234567890123456789', approverAccounts: ['worker'], profiles: [{
    id: 'fixture', revision: '1', skillId: 'safe-edit', caseIds: ['verify'], targetCaseIds: ['verify'], maxDurationMs: 1000,
    evaluate: async ({ baseline, candidate }) => ({ risk: 'low', cases: [{ id: 'verify', baseline: baseline.includes('\nverify\n'), candidate: candidate.includes('\nverify\n') }] }),
  }] };
  const seedToken = registration.accessToken;
  const server = createServer(root, { readOnly, skillEvolution: host });
  const client = new Client({ name: 'skill-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  cleanups.push(async () => { await client.close(); await server.close(); });
  const login = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'auth.login', arguments: { accountId: 'worker', password: 'synthetic-password-only' } } });
  expect(login.isError).not.toBe(true);
  registration.accessToken = JSON.parse((login.content[0] as { text: string }).text).accessToken;
  const raw = (endpointId: string, args: Record<string, unknown> = {}, authenticated = true) => client.callTool({ name: 'call_endpoint',
    arguments: { endpointId, arguments: { ...args, ...(authenticated && { accessToken: registration.accessToken }) } } });
  const call = async (endpointId: string, args: Record<string, unknown> = {}, authenticated = true) => {
    const result = await raw(endpointId, args, authenticated); expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  const service = new SkillEvolutionService(fs, new ScopeAccessPolicy(), auth, host);
  const seed = async () => {
    const principal = registration.principal, current = await service.resolve({ skillId: 'safe-edit', principal });
    const e = await service.experience({ skillId: 'safe-edit', principal, accessToken: seedToken, requestId: 'experience', expectedRevision: 'missing',
      usedVersion: { path: current.path, revision: current.revision }, applied: true, outcome: 'failure', shareable: true,
      context: 'Synthetic task', summary: 'Verify after patch.', evidence: [evidence] });
    const c = await service.candidate({ skillId: 'safe-edit', principal, accessToken: seedToken, op: 'create', requestId: 'candidate', expectedRevision: 'missing',
      baseRevision: current.revision, expectedCurrentRevision: current.currentRevision, content: '# editCurrentMarker\nread\npatch\nverify\n',
      reason: 'Verify the patch', conditions: 'Authorized patch', experiences: [{ path: e.path, revision: e.revision }] });
    return { c, principal, current };
  };
  return { root, fs, server, client, host, registration, seedToken, service, call, raw, seed };
}

test('six dynamic skill endpoints share the existing five-tool MCP control plane', async () => {
  const f = await fixture();
  expect((await f.client.listTools()).tools.map(t => t.name).sort()).toEqual(['orient_wiki', 'get_agent_pulse', 'list_active_capabilities', 'search_capabilities', 'call_endpoint'].sort());
  for (const endpointId of ['skill.resolve', 'skill.experience', 'skill.candidate', 'skill.evaluate', 'skill.promote', 'skill.rollback']) {
    const found = await f.client.callTool({ name: 'search_capabilities', arguments: { query: endpointId, maxChars: 12000, accessToken: f.registration.accessToken } });
    expect(JSON.parse((found.content[0] as { text: string }).text).endpoints.some((e: any) => e.endpointId === endpointId)).toBe(true);
  }
  const { c } = await f.seed();
  const evaluation = await f.call('skill.evaluate', { skillId: 'safe-edit', candidateId: c.candidateId, expectedRevision: c.revision, requestId: 'evaluate', op: 'run' });
  expect(evaluation.status).toBe('passed');
  const args = { skillId: 'safe-edit', candidateId: c.candidateId, evaluationId: evaluation.evaluationId, mode: 'auto', expectedRevision: 'missing' };
  const preview = await f.call('skill.promote', { ...args, op: 'preview' });
  await f.call('skill.promote', { ...args, op: 'apply', fingerprint: preview.fingerprint, requestId: 'promote' });
  const current = await f.call('skill.resolve', { skillId: 'safe-edit', maxChars: 1024 }, false);
  expect(current.status).toBe('active'); expect(JSON.stringify(current).length).toBeLessThanOrEqual(1024);
});

test('read-only catalog and dispatcher allow mixed reads but reject all skill writes', async () => {
  const f = await fixture(true), { c } = await f.seed();
  expect((await f.call('skill.resolve', { skillId: 'safe-edit' })).status).toBe('original');
  expect((await f.call('skill.candidate', { skillId: 'safe-edit', candidateId: c.candidateId, op: 'read' })).candidateId).toBe(c.candidateId);
  expect((await f.call('skill.candidate', { skillId: 'safe-edit', op: 'list' })).items).toHaveLength(1);
  for (const [endpointId, op] of [['skill.experience', undefined], ['skill.candidate', 'create'], ['skill.candidate', 'update'], ['skill.candidate', 'reject'],
    ['skill.evaluate', 'run'], ['skill.promote', 'apply'], ['skill.rollback', 'apply']]) {
    const denied = await f.raw(endpointId!, { skillId: 'safe-edit', op });
    expect(denied.isError, endpointId).toBe(true); expect(JSON.stringify(denied)).toMatch(/read.only/i);
  }
  const found = await f.client.callTool({ name: 'search_capabilities', arguments: { query: 'skill.candidate', maxChars: 12000 } });
  const catalog = JSON.parse((found.content[0] as { text: string }).text);
  expect(catalog.endpoints[0].operations.read.available).toBe(true);
  expect(catalog.endpoints[0].operations.create.available).toBe(false);
});

test('normal search/context favor the current skill and exclude candidate/audit records', async () => {
  const f = await fixture(), { c, principal } = await f.seed();
  const evaluation = await f.service.evaluate({ skillId: 'safe-edit', principal, accessToken: f.seedToken, candidateId: c.candidateId, expectedRevision: c.revision, requestId: 'evaluate', op: 'run' });
  const args = { skillId: 'safe-edit', principal, accessToken: f.seedToken, candidateId: c.candidateId, evaluationId: evaluation.evaluationId, expectedRevision: 'missing', mode: 'auto' };
  const preview = await f.service.promote({ ...args, op: 'preview' });
  await f.service.promote({ ...args, op: 'apply', fingerprint: preview.fingerprint, requestId: 'promote' });
  const current = await f.service.resolve({ skillId: 'safe-edit', principal });
  const found = await f.call('wiki.search', { query: 'editCurrentMarker', limit: 5, maxChars: 4000 });
  expect(found[0].physicalPath || found[0].p).toBe(current.path);
  expect(found.some((x: any) => /\/_evolution\/(?:candidates|evaluations|experiences)\//.test(x.physicalPath || x.p))).toBe(false);
  const packet = await f.call('wiki.context_pack', { query: 'editCurrentMarker', maxChars: 4000 });
  expect(packet.sources.some((x: any) => x.path === current.path && x.role === 'procedural_reference')).toBe(true);
  expect(packet.sources.some((x: any) => x.path === c.path)).toBe(false);
  expect(JSON.stringify(packet).length).toBeLessThanOrEqual(4000);
  expect((await f.call('notes.read', { path: c.path, maxChars: 2000 })).revision).toBe(c.revision);
  expect((await f.raw('notes.write', { path: c.path, content: 'forged', expectedRevision: c.revision })).isError).toBe(true);
  const explicit = await f.call('wiki.context_pack', { query: 'editCurrentMarker', path: c.path, maxChars: 4000 });
  expect(explicit.sources.some((x: any) => x.path === c.path)).toBe(false);
  await f.fs.writeNote({ path: 'Knowledge/skillAuditLink.md', content: '# Audit link test', frontmatter: { llm_wiki_type: 'knowledge', note_kind: 'atomic', title: 'auditLinkMarker', related: [c.path] } });
  const linked = await f.call('wiki.answer_packet', { query: 'auditLinkMarker', maxChars: 4000 });
  expect(linked.sources.some((x: any) => x.path === c.path)).toBe(false);
  const excluded = await f.call('wiki.search', { query: 'editCurrentMarker', excludePaths: ['Community/Skills/safe-edit/_evolution/versions'], maxChars: 4000 });
  expect(excluded.every((x: any) => !(x.physicalPath || x.p).includes('/_evolution/'))).toBe(true);
  const constrained = await f.call('wiki.search', { query: 'editCurrentMarker path:Community/Skills/safe-edit/SKILL.md', maxChars: 4000 });
  expect(constrained.every((x: any) => !(x.physicalPath || x.p).includes('/_evolution/'))).toBe(true);
});

test('REST skill reads use the same dispatcher and authenticated mutation denial', async () => {
  const f = await fixture(true);
  const rest = await startRestApi(f.server, { host: '127.0.0.1', port: 0 }); cleanups.push(() => rest.close());
  const base = `http://127.0.0.1:${rest.port}`;
  const response = await fetch(`${base}/api/skills/resolve?skillId=safe-edit&maxChars=1024`);
  expect(response.status).toBe(200); const result = await response.json() as any; expect(result.status).toBe('original');
  const denied = await fetch(`${base}/api/skills/candidate`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${f.registration.accessToken}` },
    body: JSON.stringify({ skillId: 'safe-edit', op: 'create' }) });
  expect(denied.status).toBeGreaterThanOrEqual(400);
});
