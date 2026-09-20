import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../../tests/server-fixture.js';
import { memoryStorage } from '../../tests/evolution-test-fixture.js';
import { FileSystemService } from '../filesystem.js';
import { startRestApi } from '../rest-api.js';

test('real runtime connects indexed curation cards to completed read observations across MCP and REST', async () => {
  const root = await mkdtemp(join(tmpdir(), 'curation-runtime-')), vault = join(root, 'vault'), host = join(root, 'host');
  await mkdir(vault); await mkdir(host, { mode: 0o700 });
  if (process.platform === 'win32') await promisify(execFile)('icacls.exe', [host, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`], { windowsHide: true });
  const fs = new FileSystemService(vault);
  await fs.writeNote({ path: 'A.md', content: 'Only a synthetic test. 원본 보존.', frontmatter: { llm_wiki_type: 'knowledge', related: ['[[B]]', '[[B]]'] } });
  const { storage, records } = memoryStorage();
  vi.stubEnv('MCPVAULT_MEMORY_CACHE_DIR', host);
  const server = createServer(vault, { evolutionRuntime: { storage } });
  try {
    const runtime = getServerRuntime(server)!;
    const call = async (endpointId: string, args: any) => {
      const r = await runtime.dispatchTool('call_endpoint', { endpointId, arguments: args });
      expect(r.isError, r.content[0].text).not.toBe(true); return JSON.parse(r.content[0].text);
    };
    const { accessToken } = await call('auth.register', { accountId: 'reader', agentId: 'reader', modelId: 'fixture', password: 'synthetic-runtime-password' });
    const list = () => call('evolution.cycle', { accessToken, kind: 'curation', op: 'list', maxChars: 4000 });
    let page: any; const deadline = Date.now() + 15000;
    do { page = await list(); if (page.candidates.length) break; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
    expect(page.candidates[0]).toMatchObject({ path: 'A.md', managed: false, usage: { coverage: 'unknown' } });
    const task = await call('evolution.context', { accessToken, op: 'begin', requestId: 'begin', sessionId: 'synthetic', taskKind: 'read' });
    await call('notes.read', { accessToken, path: 'A.md', evolutionTask: task.task.id, evolutionRequestId: 'read' });
    const observed = await list();
    expect(observed.candidates[0].usage).toMatchObject({ coverage: 'observed_requests_only', matchesCurrentRevision: true, actualUse: 'unknown' });
    expect(observed.candidates[0].nextAction.endpointId).toBe('notes.read');
    const rest = await startRestApi(server, { port: 0 });
    try {
      const r = await fetch(`http://127.0.0.1:${rest.port}/api/evolution/cycle`, { method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'curation', op: 'list' }) });
      expect(r.status).toBe(200);
      const body: any = await r.json();
      expect(JSON.stringify(body)).toContain('observed_requests_only');
    } finally { await rest.close(); }
    expect(JSON.stringify([...records.values()])).not.toContain('원본 보존');
  } finally { await server.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('the existing MCP cycle endpoint exposes curation without new tools or implicit grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'curation-endpoint-'));
  const { storage, records } = memoryStorage();
  const server = createServer(root, { evolutionRuntime: { storage } });
  try {
    const runtime = getServerRuntime(server)!;
    const call = async (args: any) => {
      const response = await runtime.dispatchTool('call_endpoint', { endpointId: 'evolution.cycle', arguments: args });
      if (response.isError) throw Error(JSON.stringify(response)); return JSON.parse(response.content[0].text);
    };
    const registration = await runtime.dispatchTool('call_endpoint', { endpointId: 'auth.register', arguments: {
      accountId: 'operator', agentId: 'operator', modelId: 'synthetic', password: 'temporary-curation-fixture-only' } });
    const accessToken = JSON.parse(registration.content[0].text).accessToken;
    expect(await call({ kind: 'curation', op: 'diagnose', accessToken })).toMatchObject({
      supportedOperations: ['deduplicate_relations', 'archive_duplicate', 'merge_duplicates', 'merge_passages'], automaticApplication: false });
    const fs = new FileSystemService(root);
    await fs.writeNote({ path: 'A.md', content: '# Unmanaged', frontmatter: { llm_wiki_type: 'knowledge', related: ['[[B]]', '[[B]]'], managed: true } });
    const before = await fs.readNoteRevision('A.md');
    expect(await call({ accessToken, kind: 'curation', op: 'prepare', operation: 'deduplicate_relations', path: 'A.md', sourceRevision: before,
      requestId: 'prepare', cycleId: 'cycle', expectedRevision: 'missing' })).toMatchObject({ reason: 'curation_grant_required' });
    await expect(call({ kind: 'curation', op: 'prepare', operation: 'deduplicate_relations', path: 'A.md', sourceRevision: before,
      requestId: 'prepare', cycleId: 'cycle', expectedRevision: 'missing' })).rejects.toThrow();
    expect(await fs.readNoteRevision('A.md')).toBe(before);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
