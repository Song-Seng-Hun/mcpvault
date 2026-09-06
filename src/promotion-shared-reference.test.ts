import { afterEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true });
});
async function fixture(mixed = false) {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-promotion-shared-')); vaults.push(vault);
  for (const dir of ['Community/Tasks', 'Community/Posts', '_collaboration/discussions', 'Knowledge']) await mkdir(join(vault, dir), { recursive: true });
  await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nllm_wiki_type: knowledge\n---\n# Peer');
  for (const id of ['a', 'b']) await writeFile(join(vault, `Community/Tasks/${id}.md`),
    `---\nmcpvault_type: agent_task\nstatus: completed\ntask_id: ${id}\nretrospective: Lesson\nknowledge_notes: [Knowledge/Peer.md]\nreferences: ["scope://global/Knowledge/Peer.md"]\n---\n# Task`);
  if (mixed) {
    await writeFile(join(vault, 'Community/Posts/post.md'), '---\nmcpvault_type: blog_post\nstatus: published\ncategory: research\npost_id: post\nreferences: [Knowledge/Peer.md]\n---\n# Post');
    await writeFile(join(vault, '_collaboration/discussions/legacy.md'), '---\nmcpvault_type: discussion\nstatus: resolved\ndiscussion_id: legacy\nreferences: [Knowledge/Peer.md]\n---\n# Legacy');
  }
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  return { vault, fs, access, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)) };
}

test('all source kinds hydrate a shared public reference once and validate its revision once', async () => {
  const { fs, wiki } = await fixture(true);
  const metadata = vi.spyOn(fs, 'readNoteMetadata'), revisions = vi.spyOn(fs, 'readNoteRevision');
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items).toHaveLength(4);
  for (const item of result.items) expect(item.references).toEqual(['Knowledge/Peer.md']);
  expect(metadata.mock.calls.flatMap(([paths]) => paths).filter(path => path === 'Knowledge/Peer.md')).toHaveLength(1);
  expect(revisions.mock.calls.filter(([path]) => path === 'Knowledge/Peer.md')).toHaveLength(1);
});

test('reference reuse is request-local and the next query sees changed knowledge classification', async () => {
  const { vault, fs, wiki } = await fixture();
  const metadata = vi.spyOn(fs, 'readNoteMetadata');
  const first: any = await wiki.promotionCandidates(undefined, 10, 16000);
  for (const item of first.items) expect(item.promotionPlan.then[0].endpointId).toBe('wiki.answer_packet');
  await writeFile(join(vault, 'Knowledge/Peer.md'), '# Now an ordinary note');
  const second: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(second.items).toHaveLength(2);
  for (const item of second.items) expect(item.promotionPlan.then.map((action: any) => action.endpointId)).toContain('mcp.publish_knowledge');
  expect(metadata.mock.calls.flatMap(([paths]) => paths).filter(path => path === 'Knowledge/Peer.md')).toHaveLength(2);
});

test.each(['hidden', 'changed', 'deleted', 'access-revoked'] as const)('shared reference %s after its first use still invalidates the report', async change => {
  const { vault, fs, wiki, access } = await fixture();
  const read = fs.readNote.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    if (args[0] === 'Community/Tasks/b.md' && !changed) {
      changed = true;
      if (change === 'deleted') await rm(join(vault, 'Knowledge/Peer.md'));
      else if (change === 'access-revoked') {
        const canAccess = access.canAccessPhysicalPath.bind(access);
        vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, principal) => path !== 'Knowledge/Peer.md' && canAccess(path, principal));
      } else await writeFile(join(vault, 'Knowledge/Peer.md'), change === 'hidden' ? '---\nmoderation_status: hidden\n---\n# Hidden' : '# Changed');
    }
    return read(...args);
  });
  await expect(wiki.promotionCandidates(undefined, 10, 16000)).rejects.toThrow(/^A promotion source changed or became unavailable; retry the candidate query\.$/);
});

test.each(['missing', 'hidden'] as const)('%s reference becoming visible during the query rejects mixed promotion plans', async initial => {
  const { vault, fs, wiki } = await fixture();
  if (initial === 'missing') await rm(join(vault, 'Knowledge/Peer.md'));
  else await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nmoderation_status: hidden\n---\n# Hidden');
  const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    if (args[0] === 'Community/Tasks/b.md') await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nllm_wiki_type: knowledge\n---\n# Newly visible');
    return read(...args);
  });
  await expect(wiki.promotionCandidates(undefined, 10, 16000)).rejects.toThrow(/^A promotion source changed or became unavailable; retry the candidate query\.$/);
});

test.each(['missing', 'hidden'] as const)('%s state does not persist into the next request', async initial => {
  const { vault, fs, wiki } = await fixture();
  if (initial === 'missing') await rm(join(vault, 'Knowledge/Peer.md'));
  else await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nmoderation_status: hidden\n---\n# Hidden');
  const metadata = vi.spyOn(fs, 'readNoteMetadata');
  const first: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(first.items).toHaveLength(2);
  for (const item of first.items) expect(item.references).toEqual([]);
  expect(JSON.stringify(first)).not.toContain('Knowledge/Peer.md');
  const reads = metadata.mock.calls.flatMap(([paths]) => paths).filter(path => path === 'Knowledge/Peer.md');
  expect(reads).toHaveLength(initial === 'missing' ? 2 : 1);
  await writeFile(join(vault, 'Knowledge/Peer.md'), '---\nllm_wiki_type: knowledge\n---\n# Visible');
  const second: any = await wiki.promotionCandidates(undefined, 10, 16000);
  for (const item of second.items) expect(item.promotionPlan.then[0].endpointId).toBe('wiki.answer_packet');
});

test('missing-reference validation drains a failing batch and bounds parallel checks', async () => {
  const { vault, fs, wiki } = await fixture();
  const paths = Array.from({ length: 18 }, (_, i) => `Knowledge/Missing${i.toString().padStart(2, '0')}.md`);
  for (const id of ['a', 'b']) await writeFile(join(vault, `Community/Tasks/${id}.md`),
    `---\nmcpvault_type: agent_task\nstatus: completed\ntask_id: ${id}\nretrospective: Lesson\nreferences: ${JSON.stringify(paths)}\n---\n# Task`);
  const read = fs.readNoteMetadata.bind(fs), counts = new Map<string, number>();
  let active = 0, peak = 0, settled = false;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const path = args[0][0]!;
    counts.set(path, (counts.get(path) || 0) + 1);
    if (!paths.includes(path) || counts.get(path) !== 2) return read(...args);
    active++; peak = Math.max(peak, active);
    try {
      expect(args[2]).toMatchObject({ fresh: true, strict: true, maxBytes: 8 * 1024 * 1024 });
      if (path === paths[0]) { await started; throw new Error('PRIVATE STORAGE FAILURE'); }
      if (path === paths[1]) { entered(); await gate; }
      return await read(...args);
    } finally { active--; }
  });
  const pending = wiki.promotionCandidates(undefined, 10, 16000).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await started;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); }
  const result = await pending;
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toBe('Error: A promotion source changed or became unavailable; retry the candidate query.');
  expect(active).toBe(0);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
  expect([...counts.values()].filter(count => count === 2)).toHaveLength(8);
});
