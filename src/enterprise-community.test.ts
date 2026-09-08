import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAuthService } from './scope-auth.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { SocialService } from './social.js';
import { AgentDirectoryService } from './agent-directory.js';
import { extractMentions } from './social.js';
import { resolveActorMention } from './enterprise-identity.js';
import type { ScopePrincipal } from './scope-auth.js';

const actors: ScopePrincipal[] = ['network', 'research'].map(agentId => ({ accountId: agentId, agentId, modelId: 'codex', role: 'agent', commandCenterId: 'acme' }));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('public community mentions retain exact actor IDs and reject ambiguous model aliases', () => {
  expect(extractMentions('Please ask @actor:acme:network, not a random @codex.')).toEqual(['actor:acme:network', 'codex']);
  expect(resolveActorMention('@actor:acme:network', actors)).toBe('actor:acme:network');
  expect(() => resolveActorMention('@codex', actors)).toThrow(/ambiguous/i);
});

test('public-root services keep profiles, posts, and comments isolated with actor ownership and revisions', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'enterprise-community-')); roots.push(vault);
  const fileSystem = new FileSystemService(vault);
  const auth = new ScopeAuthService(vault, { commandCenterId: 'acme' });
  const first = (await auth.register({ accountId: 'network-account', userId: 'employee-a', modelId: 'codex', agentId: 'network', password: 'long-enough-password' })).principal;
  const second = (await auth.register({ accountId: 'research-account', userId: 'employee-b', modelId: 'codex', agentId: 'research', password: 'long-enough-password' })).principal;
  const access = new ScopeAccessPolicy({ commandCenterId: 'acme' });
  const root = 'PublicCommunity';
  const directory = new AgentDirectoryService(fileSystem, auth, { communityRoot: root, publicMode: true });
  const social = new SocialService(fileSystem, access, new ReferenceService(fileSystem, access), { getMany: async () => new Map() } as any, undefined, { communityRoot: root, publicMode: true });
  const profile = await directory.update({ principal: first, displayName: 'Network', expectedRevision: 'missing' });
  expect(profile.profile).toMatchObject({ actorId: 'actor:acme:network', authorLabel: expect.any(String) });
  expect(JSON.stringify(profile.profile)).not.toMatch(/userId|familyId|accountId/i);
  const post = await social.publishBlogPost({ principal: first, slug: 'root-only', title: 'Root only', content: 'Hello', expectedRevision: 'missing' });
  expect(post.path).toBe('PublicCommunity/Posts/root-only.md');
  const written = await readFile(join(vault, post.path), 'utf8');
  expect(written).toContain('author: actor:acme:network');
  expect(written).not.toMatch(/user_id|family_id|account_id/i);
  await expect(fileSystem.readNote('Community/Posts/root-only.md')).rejects.toThrow(/not found/i);
  await expect(social.publishBlogPost({ principal: second, slug: 'root-only', title: 'Hijack', content: 'No', expectedRevision: post.revision })).rejects.toThrow(/original post author/i);
  await social.publishBlogPost({ principal: first, slug: 'root-only', title: 'Updated', content: 'Updated', expectedRevision: post.revision });
  await expect(social.publishBlogPost({ principal: first, slug: 'root-only', title: 'Stale', content: 'Stale', expectedRevision: post.revision })).rejects.toThrow(/revision/i);
  const comment = await social.commentOnBlogPost({ principal: second, slug: 'root-only', content: 'Ask @actor:acme:network' });
  expect(comment.path).toMatch(/^PublicCommunity\/Comments\/root-only\//);
  const comments = await social.listBlogComments({ slug: 'root-only' });
  expect(comments.comments[0]).toMatchObject({ author: 'actor:acme:research' });
  await expect(social.editBlogComment({ principal: first, slug: 'root-only', commentId: comment.commentId, content: 'Hijack', expectedRevision: comment.revision })).rejects.toThrow(/original comment author/i);
  await social.editBlogComment({ principal: second, slug: 'root-only', commentId: comment.commentId, content: 'Edited', expectedRevision: comment.revision });
  expect((await social.listBlogPosts({ author: 'actor:acme:network' })).posts[0]).toMatchObject({ title: 'Updated' });
});
