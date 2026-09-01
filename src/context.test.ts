import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, getServerRuntime } from './createServer.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const vaults: string[] = [];

afterEach(async () => {
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});

async function seed(vault: string, path: string, content: string, frontmatter: Record<string, unknown>) {
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  await fs.writeNote({ path, content, frontmatter, expectedRevision: 'missing' });
}

function json(result: any): any {
  return JSON.parse(result.content[0].text);
}

test('read_context returns the post, exact comment, thread parent, nearby comments, and references', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-context-'));
  vaults.push(vault);
  await seed(vault, 'Evidence.md', 'Grounded evidence for the discussion.\n', { title: 'Evidence' });
  await seed(vault, 'Community/Posts/context-post.md', 'The shared claim under review.\n', {
    mcpvault_type: 'blog_post', post_id: 'context-post', title: 'Context post', author: 'codex', status: 'published', references: ['Evidence.md'],
  });
  await seed(vault, 'Community/Comments/context-post/first.md', 'The first observation.\n', {
    mcpvault_type: 'blog_comment', comment_id: 'first', post_id: 'context-post', author: 'claude', created_at: '2026-09-01T00:00:00Z', workflow_status: 'open',
  });
  await seed(vault, 'Community/Comments/context-post/reply.md', 'The reply adds a qualification.\n', {
    mcpvault_type: 'blog_comment', comment_id: 'reply', post_id: 'context-post', author: 'codex', reply_to: 'first', created_at: '2026-09-01T00:01:00Z', workflow_status: 'open', references: ['Evidence.md'],
  });

  const server = createServer(vault);
  const runtime = getServerRuntime(server)!;
  const result = json(await runtime.dispatchTool('read_context', {
    targetType: 'comment', slug: 'context-post', commentId: 'reply', contextBefore: 2, contextAfter: 2, maxChars: 3000,
  }));

  expect(result.protocol).toBe('mcpvault-context/v1');
  expect(result.root.fm.post_id).toBe('context-post');
  expect(result.target.commentId).toBe('reply');
  expect(result.parentChain[0].commentId).toBe('first');
  expect(result.references[0].path).toBe('Evidence.md');
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(3000);
  await server.close();
});

test('read_context anchors chat messages without loading the entire room', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-chat-context-'));
  vaults.push(vault);
  await seed(vault, 'Community/ChatRooms/research.md', '# Research\n', {
    mcpvault_type: 'chat_room', room_id: 'research', title: 'Research', status: 'open', created_by: 'codex', created_at: '2026-09-01T00:00:00Z',
  });
  for (const [id, time, body, replyTo] of [
    ['one', '2026-09-01T00:00:00Z', 'Earlier message', undefined],
    ['two', '2026-09-01T00:01:00Z', 'Target message', undefined],
    ['three', '2026-09-01T00:02:00Z', 'A reply', 'two'],
  ] as const) {
    await seed(vault, `Community/ChatMessages/research/${id}.md`, `${body}\n`, {
      mcpvault_type: 'chat_message', message_id: id, room_id: 'research', author: 'codex', created_at: time, workflow_status: 'open', ...(replyTo && { reply_to: replyTo }),
    });
  }
  const server = createServer(vault);
  const runtime = getServerRuntime(server)!;
  const result = json(await runtime.dispatchTool('read_context', {
    targetType: 'message', roomId: 'research', messageId: 'two', contextBefore: 1, contextAfter: 1, maxChars: 2400,
  }));

  expect(result.root.fm.room_id).toBe('research');
  expect(result.target.messageId).toBe('two');
  expect(result.neighbors.map((item: any) => item.messageId)).toEqual(expect.arrayContaining(['one', 'three']));
  await server.close();
});
