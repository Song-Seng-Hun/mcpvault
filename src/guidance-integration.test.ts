import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { GuidanceCatalog, guidanceSourceRevision, serializeGuidanceNote } from './guidance-catalog.js';
import { NoticeRegistry } from './notices.js';
import { FileSystemService } from './filesystem.js';
import { GUIDANCE_DEFINITIONS } from './guidance-defaults.generated.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'guidance-mcp-')); cleanup.push(() => rm(root, { force: true, recursive: true }));
  const vault = join(root, 'vault'); await mkdir(vault);
  const definition = { id: 'guid-path', kind: 'prose' as const, template: 'Path to the note relative to vault root', parts: ['Path to the note relative to vault root'], sources: [{ file: 'src/createServer.ts', line: 1 }], binding: 'projection' as const };
  const policy = { version: 1, vaultPath: vault, notices: [], guidance: { root: '_wiki/Interface', editors: ['editor'] } };
  const configPath = join(root, 'notices.json'); await writeFile(configPath, JSON.stringify(policy));
  const errorDefinition = GUIDANCE_DEFINITIONS.find(d => d.id === 'guid-d32df3d628611da9')!;
  const definitions = [definition, errorDefinition];
  const catalog = new GuidanceCatalog(vault, () => ({ root: '_wiki/Interface', editors: ['editor'] }), definitions);
  const path = catalog.pathFor(definition.id); await mkdir(join(vault, '_wiki/Interface/prose'), { recursive: true });
  await writeFile(join(vault, path), serializeGuidanceNote(definition, '볼트 기준 문서 경로'));
  await writeFile(join(vault, 'Ordinary.md'), definition.template);
  await writeFile(join(vault, catalog.pathFor(errorDefinition.id)), serializeGuidanceNote(errorDefinition, 'Long explanation. '.repeat(32)));
  const server = createServer(vault, { noticeConfigPath: configPath, guidanceDefinitions: definitions }); cleanup.push(() => server.close());
  const client = new Client({ name: 'guidance-integration', version: '1' }); cleanup.push(() => client.close());
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (endpointId: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args } });
    return { error: Boolean(result.isError), value: result.isError ? (result.content as any[])[0].text : JSON.parse((result.content as any[])[0].text) };
  };
  return { client, call, vault, definition, path, configPath, policy };
}

test('MCP descriptions reflect Vault edits but ordinary document content is not translated', async () => {
  const { client, call, vault, definition, path } = await fixture();
  expect((await client.listTools()).tools).toHaveLength(5);
  const search = () => client.callTool({ name: 'search_capabilities', arguments: { query: 'notes.read', limit: 1, maxChars: 12000 } });
  expect(JSON.stringify(await search())).toContain('볼트 기준 문서 경로');
  expect((await call('notes.read', { path: 'Ordinary.md' })).value.content).toBe(definition.template);
  await writeFile(join(vault, path), serializeGuidanceNote(definition, '현재 볼트 안의 정확한 문서 경로'));
  expect(JSON.stringify(await search())).toContain('현재 볼트 안의 정확한 문서 경로');
  const inventory = await call('guidance.catalog', { query: definition.id, limit: 2, maxChars: 2000 });
  expect(inventory.error).toBe(false);
  expect(inventory.value.entries[0]).toMatchObject({ id: definition.id, status: 'override' });
  expect(JSON.stringify(inventory.value).length).toBeLessThanOrEqual(2000);
});

test('guidance uses delegated notice revision workflow and blocks raw edits including ancestor moves', async () => {
  const { call, definition, path, vault, configPath, policy } = await fixture();
  const registered = await call('auth.register', { accountId: 'editor', agentId: 'editor', modelId: 'codex', userId: 'test-owner', password: 'isolated-test-password-123' });
  const accessToken = registered.value.accessToken;
  const current = await call('notice.read', { id: definition.id });
  expect(current.error).toBe(false);
  expect((await call('notes.write', { path, content: 'Bypass', expectedRevision: current.value.revision, accessToken })).error).toBe(true);
  const registry = new NoticeRegistry(vault, configPath);
  const guarded = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, undefined, undefined, p => registry.assertMutation(p));
  await expect(guarded.moveFile({ oldPath: '_wiki', newPath: 'Moved', confirmOldPath: '_wiki', confirmNewPath: 'Moved' } as any)).rejects.toThrow(/notice/i);
  const args = { id: definition.id, content: '수정 대상의 볼트 상대 경로', sourceRevision: guidanceSourceRevision(definition), expectedRevision: current.value.revision, reason: 'Clarify the path label', accessToken };
  const preview = await call('notice.preview', args); expect(preview.error).toBe(false);
  const changed = await call('notice.revise', { ...args, fingerprint: preview.value.fingerprint });
  expect(changed.error).toBe(false);
  expect((await call('notice.read', { id: definition.id })).value.content).toContain(args.content);
  const next = { ...args, content: 'Revoked editor must not write', expectedRevision: changed.value.revision };
  const beforeRevocation = await call('notice.preview', next);
  await writeFile(configPath, JSON.stringify({ ...policy, guidance: { ...policy.guidance, editors: [] } }));
  expect((await call('notice.revise', { ...next, fingerprint: beforeRevocation.value.fingerprint })).error).toBe(true);
  expect(await readFile(join(vault, path), 'utf8')).toContain(args.content);
});

test('source re-review may retain wording and errors remain bounded without losing classification', async () => {
  const { call, definition, vault, path } = await fixture();
  const auth = await call('auth.register', { accountId: 'editor', agentId: 'editor', modelId: 'codex', userId: 'test-owner', password: 'isolated-test-password-123' });
  const accessToken = auth.value.accessToken;
  const error = await call('continuity.save', { accessToken, topic: '', summary: '', nextAction: '', maxChars: 512 });
  expect(error.error).toBe(true); expect(error.value.length).toBeLessThanOrEqual(512);
  expect(JSON.parse(error.value).error).toBe('invalid_checkpoint_input');
  const body = 'Keep this reviewed wording.';
  await writeFile(join(vault, path), serializeGuidanceNote({ ...definition, template: 'An older default', parts: ['An older default'] }, body));
  const current = await call('notice.read', { id: definition.id });
  const args = { id: definition.id, content: current.value.content, expectedRevision: current.value.revision, sourceRevision: guidanceSourceRevision(definition), reason: 'Re-reviewed against current source; wording still applies', accessToken };
  const preview = await call('notice.preview', args); expect(preview.error).toBe(false);
  expect((await call('notice.revise', { ...args, fingerprint: preview.value.fingerprint })).error).toBe(false);
  const reread = await call('notice.read', { id: definition.id });
  expect(reread.value.guidance.status).toBe('override'); expect(reread.value.content.trim()).toBe(body);
});
