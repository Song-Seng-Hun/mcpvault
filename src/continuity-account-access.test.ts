import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ContinuityService } from './continuity.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const owner = { accountId: 'owner', modelId: 'codex', role: 'model' as const };
const other = { accountId: 'other', modelId: 'codex', agentId: 'other', role: 'agent' as const };

test('model checkpoint path is account-qualified and generic access rejects same-model peers and aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'continuity-owner-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), service = new ContinuityService(fs, { access });
  const saved = await service.save({ principal: owner, topic: 'Private', summary: 'Do not share with model peers.', nextAction: 'Continue.' });
  expect(saved.path).toBe('scope://model/codex/_continuity/accounts/owner/work-state.md');
  const path = '_scopes/models/codex/_continuity/accounts/owner/work-state.md';
  for (const candidate of [path, path.toUpperCase(), path.replaceAll('/', '\\'), path.replace('/_continuity/', '/./_continuity/'), path.replace('/_continuity/', '/_continuity. /')]) {
    expect(access.canAccessPhysicalPath(candidate, other), candidate).toBe(false);
  }
  expect(() => access.resolveExternalPath(saved.path, other)).toThrow(/denied/i);
  expect(access.canReferenceFrom('_scopes/models/codex/Public.md', path)).toBe(false);
  expect(access.canAccessPhysicalPath(path, owner)).toBe(true);
  expect(access.canAccessPhysicalPath('_scopes/models/codex/_continuity/work-state.md', other)).toBe(false);
});

test('two registered accounts cannot bypass continuity ownership through generic MCP routes', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'continuity-account-mcp-')); roots.push(vault);
  const fs = new FileSystemService(vault), service = new ContinuityService(fs);
  const server = createServer(vault, { version: 'account-isolation-test' }), client = new Client({ name: 'isolation', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const call = async (endpointId: string, args: Record<string, unknown>, token?: string) => {
    const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: args, ...(token && { accessToken: token }) } });
    const text = (result.content as any[]).map(item => item.text || '').join('');
    let value: any; try { value = JSON.parse(text); } catch { /* plain error */ }
    return { text, value, error: result.isError };
  };
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    const model = await call('auth.register', { accountId: 'owner', modelId: 'codex', userId: 'family', password: randomUUID() });
    const peer = await call('auth.register', { accountId: 'other', modelId: 'codex', agentId: 'other', userId: 'family', password: randomUUID() });
    expect(model.error, model.text).toBeFalsy(); expect(peer.error, peer.text).toBeFalsy();
    const saved = await service.save({ principal: model.value.principal, topic: 'Private', summary: 'owner-only-sentinel', nextAction: 'Continue privately.' });
    const oldPath = '_scopes/models/codex/_continuity/work-state.md';
    await fs.writeNote({ path: oldPath, content: 'legacy-owner-sentinel', frontmatter: { owner_account_id: 'owner' } });
    expect((await call('notes.read', { path: saved.path, maxChars: 3000 }, model.value.accessToken)).error).toBeFalsy();
    for (const path of [saved.path, 'scope://model/codex/_continuity/work-state.md', './_scopes/models/codex/_continuity/accounts/owner/work-state.md', './_scopes/models/codex/_continuity/work-state.md', join(vault, '_scopes/models/codex/_continuity/accounts/owner/work-state.md'), join(vault, oldPath)]) {
      for (const [endpointId, extra] of [['notes.read', {}], ['mcp.read_note_lines', { startLine: 1, endLine: 30 }], ['notes.read', { property: 'topic' }], ['notes.patch', { oldString: 'Private', newString: 'Stolen' }]] as const) {
        const result = await call(endpointId, { path, maxChars: 3000, ...extra }, peer.value.accessToken);
        expect(result.error, `${endpointId}: ${result.text}`).toBe(true);
        expect(result.text).not.toContain('owner-only-sentinel'); expect(result.text).not.toContain('legacy-owner-sentinel');
      }
    }
    const fallback = await call('mcp.read_scoped_note', { path: '_continuity/work-state.md' }, peer.value.accessToken);
    expect(fallback.error, fallback.text).toBe(true);
    for (const endpointId of ['wiki.search_scoped', 'wiki.search']) {
      const result = await call(endpointId, { query: 'sentinel', limit: 100, maxChars: 4000 }, peer.value.accessToken);
      expect(result.error, result.text).toBeFalsy(); expect(result.text).not.toContain('sentinel');
    }
  } finally { await client.close(); await server.close(); }
});
