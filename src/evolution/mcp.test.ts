import { test, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../../tests/server-fixture.js';
import { operationReadAlias } from '../operation-contracts.js';

test('dynamic evolution diagnosis exposes no authority; private reads require authentication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evolution-mcp-'));
  const server = createServer(root);
  try {
    const runtime = getServerRuntime(server)!;
    runtime.ensureEndpointRegistry();
    const call = (endpointId: string, args: any) => runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
    const result = await call('evolution.cycle', { op: 'diagnose' });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(JSON.stringify(result)).toContain('diagnostic_only');
    expect((await call('evolution.context', {})).isError).toBe(true);
    expect((await call('evolution.feedback', { op: 'record', human: true, approved: true })).isError).toBe(true);
    expect(operationReadAlias('manage_evolution_cycle', 'preview')).toBe('read_evolution_cycle');
    expect(operationReadAlias('manage_evolution_cycle', 'apply')).toBeUndefined();
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
