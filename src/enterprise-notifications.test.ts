import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { NotificationService } from './notifications.js';
import type { ScopePrincipal } from './scope-auth.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test.each([
  ['Posts', 'blog_post', 'post_id'],
  ['Comments', 'blog_comment', 'comment_id'],
  ['ChatMessages', 'chat_message', 'message_id'],
])('company %s notifications match exact actor mentions without same-model or cross-realm delivery', async (folder, type, idField) => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-notifications-')); roots.push(root);
  const fs = new FileSystemService(root);
  const service = new NotificationService(fs, { getMany: async () => new Map() } as never);
  const principal: ScopePrincipal = { accountId: 'network-account', agentId: 'network', modelId: 'codex', userId: 'employee', role: 'agent', commandCenterId: 'acme', enterprise: { mode: 'company', realmId: 'acme', runtimeId: 'internal', sharedMemoryEnabled: true } };
  for (const [id, mention] of [['exact', 'actor:acme:network'], ['model', 'codex'], ['alias', 'network']]) {
    await fs.writeNote({ path: `Community/${folder}/${id}.md`, content: `Message ${id}`, frontmatter: { mcpvault_type: type, [idField]: id, title: id, status: 'published', author: 'research', mentions: [mention], created_at: '2026-09-08T00:00:00.000Z' } });
  }
  try {
    const result = await service.list({ principal });
    expect(result.total).toBe(1);
    expect(result.notifications.map(item => item.sourceId)).toEqual(['exact']);
    const peer = await service.list({ principal: { ...principal, accountId: 'memory-account', agentId: 'memory' } });
    expect(peer.total).toBe(0);
    const otherRealm = await service.list({ principal: { ...principal, accountId: 'other-network', commandCenterId: 'other', enterprise: { ...principal.enterprise!, realmId: 'other' } } });
    expect(otherRealm.total).toBe(0);
  } finally { await service.close(); }
});
