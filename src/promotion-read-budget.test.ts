import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { VaultIoCoordinator } from './vault-io.js';
import { readBoundedSource } from './bounded-source-read.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});

async function fixture(kind: 'post' | 'task' | 'legacy' = 'task') {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-promotion-read-')); vaults.push(vault);
  for (const dir of ['Community/Posts', 'Community/Tasks', '_collaboration/discussions', 'Knowledge']) {
    await mkdir(join(vault, dir), { recursive: true });
  }
  const source = kind === 'post' ? 'Community/Posts/sample.md' : kind === 'task' ? 'Community/Tasks/sample.md' : '_collaboration/discussions/sample.md';
  const fields = kind === 'post' ? 'mcpvault_type: blog_post\nstatus: published\npost_id: sample\ncategory: research'
    : kind === 'task' ? 'mcpvault_type: agent_task\nstatus: completed\ntask_id: sample\nretrospective: A lesson\nknowledge_notes: [Knowledge/Peer.md]'
      : 'mcpvault_type: discussion\nstatus: resolved\ndiscussion_id: sample';
  await writeFile(join(vault, source), `---\n${fields}\nreferences: [Knowledge/Peer.md]\n---\n# Lesson`);
  await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nllm_wiki_type: knowledge\n---\n# Existing lesson');
  const io = new VaultIoCoordinator();
  const fs = new FileSystemService(vault, undefined, undefined, undefined, undefined, undefined, io);
  const access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  return { vault, fs, io, wiki, source };
}

test.each(['post', 'task', 'legacy'] as const)('%s reference storage failure must not become an empty-reference publication plan', async kind => {
  const { io, wiki } = await fixture(kind);
  const fail = (path: string) => {
    if (path.replace(/\\/g, '/').endsWith('/Knowledge/Peer.md')) {
      throw Object.assign(new Error('EIO private-storage-detail'), { code: 'EIO' });
    }
  };
  vi.spyOn(io, 'readUtf8').mockImplementation(async path => { fail(path); return readFile(path, 'utf8'); });
  vi.spyOn(io, 'readUtf8Bounded').mockImplementation(async (path, maxBytes) => { fail(path); return readBoundedSource(path, maxBytes); });
  await expect(wiki.promotionCandidates()).rejects.toThrow(/^A promotion source changed or became unavailable; retry the candidate query\.$/);
});

test('source hydration failure must not quietly erase a ranked candidate', async () => {
  const { fs, io, wiki } = await fixture();
  let hydrating = false;
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => { hydrating = true; return read(...args); });
  const fail = () => {
    if (hydrating) throw Object.assign(new Error('EACCES private-storage-detail'), { code: 'EACCES' });
  };
  vi.spyOn(io, 'readUtf8').mockImplementation(async path => { fail(); return readFile(path, 'utf8'); });
  vi.spyOn(io, 'readUtf8Bounded').mockImplementation(async (path, cap) => { fail(); return readBoundedSource(path, cap); });
  await expect(wiki.promotionCandidates()).rejects.toThrow(/^A promotion source changed or became unavailable; retry the candidate query\.$/);
});

test.each(['source', 'reference'] as const)('oversized %s is rejected at initial hydration before final hashes', async target => {
  const { vault, fs, io, wiki, source } = await fixture();
  const path = target === 'source' ? source : 'Knowledge/Peer.md';
  const original = await readFile(join(vault, path), 'utf8');
  // Grow after ranking so this specifically exercises hydration, not inventory reads.
  const read = fs.readNote.bind(fs);
  let grown = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    if (!grown) {
      grown = true;
      await writeFile(join(vault, path), original + 'x'.repeat(MAX_NOTE_CONTENT_BYTES));
    }
    return read(...args);
  });
  const bounded = vi.spyOn(io, 'readUtf8Bounded');
  const revisions = vi.spyOn(fs, 'readNoteRevision');
  await expect(wiki.promotionCandidates()).rejects.toThrow(/promotion source changed or became unavailable/);
  expect(revisions).not.toHaveBeenCalled();
  expect(bounded.mock.calls.some(([p, cap]) => p === join(vault, path) && cap === MAX_NOTE_CONTENT_BYTES)).toBe(true);
});

test('valid hydration preserves the existing-knowledge review and caps both initial reads', async () => {
  const { fs, wiki } = await fixture();
  const sourceRead = vi.spyOn(fs, 'readNote');
  const metadataRead = vi.spyOn(fs, 'readNoteMetadata');
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].promotionPlan.then[0].arguments.path).toBe('Knowledge/Peer.md');
  expect(sourceRead.mock.calls[0]?.[1]).toBe(MAX_NOTE_CONTENT_BYTES);
  expect(metadataRead.mock.calls[0]?.[2]).toMatchObject({ fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
});

test('genuinely missing references remain omittable', async () => {
  const { vault, wiki } = await fixture();
  await rm(join(vault, 'Knowledge/Peer.md'));
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].references).toEqual([]);
  expect(result.items[0].promotionPlan.then.map((action: any) => action.endpointId)).toContain('mcp.publish_knowledge');
});

test('exactly-at-limit multibyte hydration preserves complete content and revision', async () => {
  const { vault, fs, wiki } = await fixture();
  const header = '---\nllm_wiki_type: knowledge\n---\n';
  const prefix = header + 'a'.repeat(65535 - Buffer.byteLength(header));
  const raw = prefix + '한' + 'b'.repeat(MAX_NOTE_CONTENT_BYTES - Buffer.byteLength(prefix) - 3);
  await writeFile(join(vault, 'Knowledge/Peer.md'), raw);
  expect(Buffer.byteLength(raw)).toBe(MAX_NOTE_CONTENT_BYTES);
  const unbounded = await fs.readNote('Knowledge/Peer.md');
  const bounded = await fs.readNote('Knowledge/Peer.md', MAX_NOTE_CONTENT_BYTES);
  expect(bounded).toEqual(unbounded);
  const [metadata] = await fs.readNoteMetadata(['Knowledge/Peer.md'], () => true, { strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
  expect(metadata?.revision).toBe(unbounded.revision);
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].promotionPlan.then[0].arguments.path).toBe('Knowledge/Peer.md');
});
