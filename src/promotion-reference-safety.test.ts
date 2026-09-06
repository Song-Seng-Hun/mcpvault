import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture(kind: 'post' | 'task') {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-promotion-refs-')); vaults.push(vault);
  for (const dir of ['Community/Posts', 'Community/Tasks', 'Knowledge', '_scopes/agents/worker']) await mkdir(join(vault, dir), { recursive: true });
  await writeFile(join(vault, 'Knowledge/Visible.md'), '---\nllm_wiki_type: knowledge\n---\n# Visible');
  await writeFile(join(vault, 'Knowledge/Hidden.md'), '---\nmoderation_status: hidden\n---\n# Hidden');
  await writeFile(join(vault, '_scopes/agents/worker/Secret.md'), '# PRIVATE BODY');
  const fields = kind === 'post'
    ? 'mcpvault_type: blog_post\nstatus: published\ncategory: research\npost_id: sample'
    : 'mcpvault_type: agent_task\nstatus: completed\ntask_id: sample\nretrospective: Reusable lesson\nknowledge_notes: [Knowledge/Hidden.md, "scope://agent/worker/Secret.md", Knowledge/Visible.md]';
  const path = `Community/${kind === 'post' ? 'Posts' : 'Tasks'}/sample.md`;
  await writeFile(join(vault, path), `---\n${fields}\ntitle: Sample\nreferences: [Knowledge/Visible.md, Knowledge/Hidden.md, Knowledge/Missing.md, "scope://agent/worker/Secret.md", "../escape.md", ".git/config"]\n---\n# Lesson`);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  return { vault, fs, wiki, path, access };
}

test.each(['post', 'task'] as const)('%s promotion excludes hidden/private/missing/invalid references from every plan', async kind => {
  const { fs, wiki } = await fixture(kind);
  const reads = vi.spyOn(fs, 'readNoteMetadata');
  const result: any = await wiki.promotionCandidates({ accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' }, 10, 16000);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].references).toEqual(['Knowledge/Visible.md']);
  expect(JSON.stringify(result)).not.toMatch(/Hidden\.md|Secret\.md|Missing\.md|escape\.md|\.git\/config|PRIVATE BODY/);
  expect(reads.mock.calls.flatMap(([paths]) => paths).some(path => path.includes('Secret'))).toBe(false);
  if (kind === 'task') expect(result.items[0].promotionPlan.then[0].arguments.path).toBe('Knowledge/Visible.md');
});

test('a task with no surviving linked knowledge gets a publish plan, not a hidden review action', async () => {
  const { vault, wiki, path } = await fixture('task');
  await writeFile(join(vault, path), '---\nmcpvault_type: agent_task\nstatus: completed\ntask_id: sample\nretrospective: Lesson\nknowledge_notes: [Knowledge/Hidden.md]\n---\n# Lesson');
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].references).toEqual([]);
  expect(result.items[0].promotionPlan.then.map((action: any) => action.endpointId)).toContain('mcp.publish_knowledge');
  expect(JSON.stringify(result)).not.toContain('Hidden.md');
});

test.each(['owner', 'reference'] as const)('promotion rejects %s drift during reference hydration', async changed => {
  const { vault, fs, wiki, path } = await fixture('task');
  const read = fs.readNoteMetadata.bind(fs);
  let injected = false;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (!injected && args[0].includes('Knowledge/Visible.md')) {
      injected = true;
      await writeFile(join(vault, changed === 'owner' ? path : 'Knowledge/Visible.md'), '---\nmoderation_status: hidden\n---\n# Changed');
    }
    return result;
  });
  await expect(wiki.promotionCandidates(undefined, 10, 16000)).rejects.toThrow(/changed|unavailable/i);
});

test('visible non-knowledge notes cannot become a linked-knowledge review target', async () => {
  const { vault, wiki, path } = await fixture('task');
  await writeFile(join(vault, 'Knowledge/Visible.md'), '# An ordinary document');
  await writeFile(join(vault, path), '---\nmcpvault_type: agent_task\nstatus: completed\ntask_id: sample\nretrospective: Lesson\nknowledge_notes: [Knowledge/Visible.md]\n---\n# Lesson');
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items[0].references).toEqual([]);
  expect(result.items[0].promotionPlan.then.map((action: any) => action.endpointId)).not.toContain('wiki.answer_packet');
});

test('Global and local Community URIs survive while foreign Community/model/User targets stay out', async () => {
  const { vault, fs, wiki, path, access } = await fixture('post');
  const center = access.getCommandCenterId();
  const foreign = center === 'foreign-center' ? 'another-center' : 'foreign-center';
  await writeFile(join(vault, 'Community/Posts/context.md'), '# Public context');
  const refs = ['scope://global/Knowledge/Visible.md', `scope://community/${center}/Posts/context.md`,
    `scope://community/${foreign}/Posts/context.md`, 'scope://model/codex/ModelSecret.md', 'scope://user/owner/UserSecret.md'];
  await writeFile(join(vault, path), `---\nmcpvault_type: blog_post\nstatus: published\ncategory: research\npost_id: sample\nreferences: ${JSON.stringify(refs)}\n---\n# Lesson`);
  const reads = vi.spyOn(fs, 'readNoteMetadata');
  const result: any = await wiki.promotionCandidates({ accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' }, 10, 16000);
  expect(result.items[0].references).toEqual(expect.arrayContaining(['Knowledge/Visible.md', 'Community/Posts/context.md']));
  expect(result.items[0].references).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(/ModelSecret|UserSecret/);
  expect(reads.mock.calls.flatMap(([paths]) => paths).some(path => path.includes('_scopes'))).toBe(false);
});

test('shared reference snapshots are hashed once in bounded batches without unrelated reads', async () => {
  const { vault, fs, wiki, path } = await fixture('task');
  const references = Array.from({ length: 20 }, (_, i) => `Knowledge/Peer${i}.md`);
  for (const path of references) await writeFile(join(vault, path), '---\nllm_wiki_type: knowledge\n---\n# Peer');
  const fields = 'mcpvault_type: agent_task\nstatus: completed\nretrospective: Lesson';
  const body = (taskId: string) => `---\n${fields}\ntask_id: ${taskId}\nreferences: ${JSON.stringify(references)}\nknowledge_notes: ${JSON.stringify(references)}\n---\n# Lesson`;
  await writeFile(join(vault, path), body('sample'));
  await writeFile(join(vault, 'Community/Tasks/second.md'), body('second'));
  const read = fs.readNoteRevision.bind(fs);
  let active = 0, peak = 0;
  const checked: string[] = [];
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    expect(maxBytes).toBe(8 * 1024 * 1024);
    checked.push(path); active++; peak = Math.max(peak, active);
    try { return await read(path, maxBytes); } finally { active--; }
  });
  const result: any = await wiki.promotionCandidates(undefined, 10, 16000);
  expect(result.items).toHaveLength(2);
  expect(checked).toHaveLength(22);
  expect(new Set(checked).size).toBe(22);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(8);
});

test('failed snapshot checks drain siblings and do not return internal errors', async () => {
  const { fs, wiki, path: owner } = await fixture('task');
  const read = fs.readNoteRevision.bind(fs);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (path, maxBytes) => {
    if (path === 'Knowledge/Visible.md') { await started; throw new Error('PRIVATE FAILURE DETAIL'); }
    if (path === owner) { entered(); await gate; }
    return read(path, maxBytes);
  });
  let settled = false;
  const result = wiki.promotionCandidates(undefined, 10, 16000).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await started;
  try { await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false); }
  finally { release(); const error = await result; expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('PRIVATE FAILURE DETAIL'); }
});
