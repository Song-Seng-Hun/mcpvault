import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const data = (result: any): any => { if (result.isError) throw new Error(JSON.stringify(result.content)); return JSON.parse(result.content[0].text); };
async function fixture(readOnly = false, existing?: string) {
  const root = existing || await mkdtemp(join(tmpdir(), 'participation-protocol-')); if (!existing) roots.push(root);
  const server = createServer(root, { version: 'test', readOnly });
  const client = new Client({ name: 'participation-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
  const endpoint = (endpointId: string, args: Record<string, unknown> = {}) => client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
  return { root, server, client, endpoint, close: async () => { await client.close(); await server.close(); } };
}
test('only five tools, default-off account settings, authenticated revisions, and community purpose execute through the public executor', async () => {
  const f = await fixture();
  try {
    const tools = await f.client.listTools(); expect(tools.tools.map(t => t.name).sort()).toEqual(['call_endpoint', 'get_agent_pulse', 'list_active_capabilities', 'orient_wiki', 'search_capabilities']);
    await f.endpoint('auth.register', { accountId: 'member', modelId: 'gpt', agentId: 'community-worker', password: 'test-only-long-password' });
    const accessToken = data(await f.endpoint('auth.login', { accountId: 'member', password: 'test-only-long-password' })).accessToken;
    expect((await f.endpoint('community.participation')).isError).toBe(true);
    const first = data(await f.endpoint('community.participation', { accessToken })); expect(first.settings.enabled).toBe(false);
    const template = data(await f.endpoint('community.participation', { accessToken, templateId: 'collaborative-creation' }));
    expect(template.activityTemplate.id).toBe('collaborative-creation');
    expect(template.activityTemplate.endConditions.length).toBeGreaterThan(0);
    expect(template.activityTemplate.effects).toEqual({ xp: 'unchanged', access: false });
    expect(template.revision).toBe(first.revision);
    expect(JSON.stringify(template).length).toBeLessThanOrEqual(4000);
    expect((await f.endpoint('community.participation', { accessToken, templateId: '__proto__' })).isError).toBe(true);
    const enabled = data(await f.endpoint('community.participation', { accessToken, op: 'update', requestId: 'enable', expectedRevision: first.revision, settings: { enabled: true, allowedTopics: ['science'], allowedActions: ['explore'] } }));
    const pulse = data(await f.client.callTool({ name: 'get_agent_pulse', arguments: { accessToken, purpose: 'community', maxChars: 1500 } }));
    expect(pulse.state).toBe('idle'); expect(JSON.stringify(pulse).length).toBeLessThanOrEqual(1500);
    expect(data(await f.endpoint('community.participation', { accessToken })).revision).toBe(enabled.revision);
    const run = data(await f.endpoint('community.participation_record', { accessToken, op: 'start', action: 'explore', expectedRevision: enabled.revision, requestId: 'run' }));
    expect(run.daily.runs).toBe(1);
    const skipped = data(await f.endpoint('community.participation_record', { accessToken, op: 'skip', runId: run.activeRun.id, expectedRevision: run.revision, requestId: 'skip' })); expect(skipped.activeRun).toBeUndefined();
  } finally { await f.close(); }
});
test('read-only mode exposes own settings read but rejects configuration and run mutations', async () => {
  const setup = await fixture();
  try { await setup.endpoint('auth.register', { accountId: 'member', modelId: 'gpt', agentId: 'community-worker', password: 'test-only-long-password' }); } finally { await setup.close(); }
  const f = await fixture(true, setup.root);
  try {
    const accessToken = data(await f.endpoint('auth.login', { accountId: 'member', password: 'test-only-long-password' })).accessToken;
    expect(data(await f.endpoint('community.participation', { accessToken })).revision).toBe('missing');
    expect(data(await f.endpoint('community.participation', { accessToken, templateId: 'evidence-puzzle' })).activityTemplate.id).toBe('evidence-puzzle');
    expect((await f.endpoint('community.participation', { accessToken, op: 'update', expectedRevision: 'missing', requestId: 'enable', settings: { enabled: false } })).isError).toBe(true);
    expect((await f.endpoint('community.participation_record', { accessToken, op: 'start', expectedRevision: 'missing', requestId: 'run', action: 'explore' })).isError).toBe(true);
  } finally { await f.close(); }
});
