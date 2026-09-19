import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../../tests/server-fixture.js';
import { hash } from './policy.js';

test('real MCP authentication connects host evidence, native persona apply and next-session observation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evolution-runtime-'));
  const records = new Map<string, any>(); let held = false;
  const storage: any = { refresh: async () => ({ version: 1, enabled: true }), acquire: async () => {
    if (held) throw Error('busy'); held = true;
    return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: {
    read: async (key: string) => ({ revision: records.has(key) ? hash(records.get(key)) : 'missing', value: structuredClone(records.get(key)) }),
    write: async (key: string, value: any, expected: string) => {
      if (!held || expected !== (records.has(key) ? hash(records.get(key)) : 'missing')) throw Error('conflict');
      records.set(key, structuredClone(value)); return { revision: hash(value) };
    },
  } };
  const server = createServer(root, { evolutionRuntime: { storage, profiles: [{
    kind: 'persona', revision: 'expression-v1', method: 'synthetic', cases: [
      { id: 'short', split: 'development', target: true, run: async ({ variant, cycle }: any) => {
        const value = variant === 'candidate' ? cycle.candidate : cycle.baseline.value;
        return { passed: value?.key === 'verbosity' && value.value === 'brief', safety: true, resultHash: hash(value) };
      } },
      { id: 'safe', split: 'holdout', run: async () => ({ passed: true, safety: true, resultHash: hash('synthetic-private-case') }) },
    ],
  }] } } as any);
  try {
    const runtime = getServerRuntime(server)!;
    const call = async (endpointId: string, args: any) => {
      const r = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
      if (r.isError) throw Error(JSON.stringify(r));
      return JSON.parse(r.content[0].text);
    };
    const login = await call('auth.register', { accountId: 'alice', modelId: 'model', agentId: 'alice', password: 'temporary-synthetic-runtime-fixture' });
    const accessToken = login.accessToken;
    expect((runtime as any).evolutionHost).toBeDefined();
    const host = (runtime as any).evolutionHost;
    const feedback = { id: 'f1', taskId: 'before', sessionId: 'before-session', target: { kind: 'persona', id: 'assistant' },
      scope: { kind: 'account', id: 'alice' }, kind: 'preference', signal: 'explicit', key: 'verbosity', value: 'brief', summary: 'Short answers.', basis: [] };
    const eventToken = await host.captureFeedback(accessToken, feedback, 'human', 'host-event');
    await call('evolution.feedback', { op: 'record', accessToken, feedback, eventToken, requestId: 'record', expectedRevision: 'missing' });
    let c = await call('evolution.cycle', { op: 'prepare', accessToken, cycleId: 'cycle', feedbackIds: ['f1'], requestId: 'prepare', expectedRevision: 'missing' });
    expect(c.status).toBe('observed');
    for (const op of ['advance', 'check']) c = await call('evolution.cycle', { op, accessToken, cycleId: c.cycleId,
      requestId: op, expectedRevision: c.revision, ...(op === 'advance' && { candidate: { key: 'verbosity', value: 'brief' } }) });
    expect(c.status).toBe('evaluated');
    const preview = await call('evolution.cycle', { op: 'preview', accessToken, cycleId: c.cycleId });
    c = await call('evolution.cycle', { op: 'apply', accessToken, cycleId: c.cycleId, requestId: 'apply', expectedRevision: c.revision, fingerprint: preview.fingerprint });
    expect(c.status).toBe('applied');
    const delivered = await host.deliverContext(accessToken, { taskId: 'next-task', sessionId: 'next-session' });
    expect(delivered.packet.preferences[0].value).toBe('brief');
    expect(delivered.receipts).toHaveLength(1);
    const useToken = await host.verifyUse(accessToken, delivered.receipts[0].token, {
      method: 'synthetic', checkId: 'actual-render-v1', evaluate: async () => {
        const output = delivered.packet.preferences[0].value === 'brief' ? 'Done.' : 'Long explanation.';
        return { used: true, success: output === 'Done.', resultHash: hash(output) };
      },
    });
    c = await call('evolution.cycle', { op: 'effect', accessToken, cycleId: c.cycleId, requestId: 'effect', expectedRevision: c.revision, useToken });
    expect(c).toMatchObject({ status: 'effect_verified', effect: { method: 'synthetic', success: true } });
    const endpointNames = JSON.stringify(await runtime.dispatchTool('search_capabilities', { query: 'captureFeedback verifyUse' }));
    expect(endpointNames).not.toContain('evolution.captureFeedback');
    expect((await runtime.dispatchTool('call_endpoint', { endpointId: 'evolution.context', arguments: {} })).isError).toBe(true);
    await expect(host.deliverContext('not-a-token', { taskId: 'next', sessionId: 'next' })).rejects.toThrow();
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
