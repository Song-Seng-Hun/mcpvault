import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, getServerRuntime } from '../../tests/server-fixture.js';
import { hash } from '../evolution/policy.js';
import { FileSystemService } from '../filesystem.js';

test('the existing MCP cycle endpoint exposes curation without new tools or implicit grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'curation-endpoint-'));
  const records = new Map<string, unknown>(); let held = false;
  const storage: any = { refresh: async () => ({ version: 1, enabled: true }), acquire: async () => {
    if (held) throw Error('busy'); held = true;
    return { assertHeld: async () => { if (!held) throw Error('lost'); }, close: async () => { held = false; } };
  }, records: { read: async (key: string) => ({ revision: records.has(key) ? hash(records.get(key)) : 'missing', value: structuredClone(records.get(key)) }),
    write: async (key: string, value: unknown, expected: string) => {
      if (!held || expected !== (records.has(key) ? hash(records.get(key)) : 'missing')) throw Error('conflict');
      records.set(key, structuredClone(value)); return { revision: hash(value) };
    } } };
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
