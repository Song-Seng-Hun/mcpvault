import { expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';
import { VaultMetadataIndex } from './vault-index.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

const principal = { accountId: 'reader', modelId: 'codex', agentId: 'recall-reader', role: 'agent' as const };
const privatePath = `_scopes/agents/recall-reader/_continuity/recall/${createHash('sha256').update('note.md').digest('hex')}.md`;
async function fixture(run: (c: { wiki: LlmWikiService; fs: FileSystemService; access: ScopeAccessPolicy; root: string;
  seed: (path: string, fields?: Record<string, unknown>) => Promise<string> }) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-recall-queue-', root = await mkdtemp(join(base, prefix));
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const seed = async (path: string, fields: Record<string, unknown> = {}) => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'Explain the mechanism.', ...fields })}---\n# Answer\nDo not reveal answer before recall.\n`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw); return raw;
  };
  try { await run({ wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)), fs, access, root, seed }); }
  finally {
    vi.restoreAllMocks(); const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('unseen reader never inherits the shared future recall date', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { last_recalled_at: '2999-01-01', recall_quality: 'good', recall_interval_days: 30 });
    const queue = await wiki.recallQueue(principal);
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({ reason: 'never_recalled', recallQuality: 'unseen', stateRevision: 'missing', recallIntervalDays: 30 });
    expect(queue.items[0].lastRecalledAt).toBeUndefined();
    expect(queue.items[0].nextRecallAt).toBeUndefined();
  });
});

test.each([false, true])('personal recall never inherits shared failure or repair, private prompt=%s', async withPrivatePrompt => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { last_recalled_at: 'bad-shared-date', recall_quality: 'failed', recall_confusion: 'SHARED-CONFUSION',
      recall_repair_status: 'needed', recall_repair_path: 'SharedRepair.md', recall_interval_days: 1 });
    await seed('SharedRepair.md', { recall_prompt: undefined });
    if (withPrivatePrompt) await seed(privatePath, { llm_wiki_type: 'agent_state', recall_prompt: 'Personal question?' });
    const result = await wiki.recallQueue(principal, 10, 12000);
    expect(result.items[0]).toMatchObject({ reason: 'never_recalled', recallQuality: 'unseen' });
    expect(result.items[0].repairStatus).toBeUndefined();
    expect(result.items[0].dateRepairAction).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/SHARED-CONFUSION|SharedRepair/);
  });
});

test('private explicit good/none state cannot revive a shared repair path or confusion', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_quality: 'failed', recall_confusion: 'SHARED-CONFUSION', recall_repair_status: 'needed', recall_repair_path: 'SharedRepair.md' });
    await seed('SharedRepair.md', { recall_prompt: undefined });
    await seed(privatePath, { llm_wiki_type: 'agent_state', recall_quality: 'good', recall_repair_status: 'none', recall_confusion: '' });
    const queue = await wiki.recallQueue(principal);
    expect(queue.items[0]).toMatchObject({ recallQuality: 'good', reason: 'never_recalled' });
    expect(queue.items[0].repairPath).toBeUndefined();
    expect(JSON.stringify(queue)).not.toMatch(/SHARED-CONFUSION|SharedRepair/);
  });
});

test('hidden private history is unavailable rather than a due task in queue and review packet', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_quality: 'failed', recall_interval_days: 1 });
    await seed(privatePath, { llm_wiki_type: 'agent_state', moderation_status: 'hidden', recall_quality: 'failed', recall_confusion: 'PRIVATE-HIDDEN' });
    expect(await wiki.recallQueue(principal)).toMatchObject({ total: 0, items: [] });
    const packet: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(packet.priorities.filter((row: any) => row.path === 'Note.md' && row.reasons?.includes('active_recall_due'))).toEqual([]);
    expect(JSON.stringify(packet)).not.toContain('PRIVATE-HIDDEN');
  });
});

test('shared failure cannot force a resolved personal repair back into the review packet', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_quality: 'failed', recall_repair_status: 'needed', recall_interval_days: 1 });
    await seed(privatePath, { llm_wiki_type: 'agent_state', recall_quality: 'good', recall_repair_status: 'resolved',
      last_recalled_at: new Date().toISOString(), recall_interval_days: 30 });
    expect(await wiki.recallQueue(principal)).toMatchObject({ total: 0, items: [] });
    const packet: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(packet.priorities.filter((row: any) => row.path === 'Note.md' && row.reasons?.includes('active_recall_due'))).toEqual([]);
  });
});

test.each([true, ['1']].map(value => [value]))('queue rejects non-scalar interval %j like the gap queue', async interval => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_interval_days: interval });
    const queue = await wiki.recallQueue(principal);
    expect(queue.items[0]).toMatchObject({ reason: 'invalid_recall_interval_days' });
    expect(queue.items[0].dateRepairAction.arguments.path).toBe('Note.md');
  });
});

test('own pending repair and shared contrast remain useful without inheriting shared history', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_quality: 'good', recall_confusion: 'OTHER-READERS-CONFUSION',
      last_recalled_at: '2999-01-01', contradicts: ['[[Contrast]]'] });
    const repairRaw = await seed('Repair.md', { recall_prompt: undefined });
    await seed('Contrast.md', { recall_prompt: undefined });
    const stateRaw = await seed(privatePath, { llm_wiki_type: 'agent_state', recall_quality: 'partial',
      recall_confusion: 'My confusion', recall_repair_status: 'in_progress', recall_repair_path: 'Repair.md' });
    const result = await wiki.recallQueue(principal, 10, 12000);
    expect(result.items[0]).toMatchObject({ reason: 'previous_recall_partial', confusion: 'My confusion', repairStatus: 'in_progress',
      repairPath: 'Repair.md', repairRevision: createHash('sha256').update(repairRaw).digest('hex'),
      stateRevision: createHash('sha256').update(stateRaw).digest('hex'),
      contrastWith: [expect.objectContaining({ target: 'Contrast.md' })] });
    expect(JSON.stringify(result)).not.toContain('OTHER-READERS-CONFUSION');
  });
});

test.each([512, 800, 1800, 12000])('recall bounds the entire %i-character response and preserves the task', async maxChars => {
  await fixture(async ({ wiki, seed, root }) => {
    const raw = await seed('Note.md', { title: 'Long title '.repeat(80), recall_confusion: 'Confusion '.repeat(80) });
    const result: any = await wiki.recallQueue(undefined, 10, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.items[0]).toMatchObject({ path: 'Note.md', revision: createHash('sha256').update(raw).digest('hex'), recallPrompt: 'Explain the mechanism.' });
    expect(JSON.stringify(result)).not.toContain('Do not reveal answer');
    expect(await readFile(join(root, 'Note.md'), 'utf8')).toBe(raw);
  });
});

test('resolved recall repairs obey their next due date', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { last_recalled_at: new Date().toISOString(), recall_interval_days: 14, recall_quality: 'good', recall_repair_status: 'resolved' });
    expect(await wiki.recallQueue()).toMatchObject({ total: 0, items: [] });
  });
});

test('invalid recall interval becomes metadata repair instead of Date overflow', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { last_recalled_at: '2020-01-01', recall_interval_days: 1e300, recall_quality: 'failed' });
    const result: any = await wiki.recallQueue();
    expect(result.items[0]).toMatchObject({ reason: 'invalid_recall_interval_days', dateRepairAction: { endpointId: 'notes.read', arguments: { path: 'Note.md' } } });
    expect(result.items[0].nextRecallAt).toBeUndefined();
  });
});

test('review packet routes invalid recall intervals to metadata repair, not recording success', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { last_recalled_at: '2020-01-01', recall_interval_days: 1e300, recall_quality: 'failed' });
    const result: any = await wiki.reviewPacket(undefined, 10, 16000);
    expect(result.curationPlan.selected.reason).toBe('invalid_recall_interval_days');
    expect(result.curationPlan.inspect).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Note.md' } });
    expect(result.curationPlan.then).toMatchObject({ endpointId: 'notes.patch', arguments: { path: 'Note.md', dryRun: true } });
  });
});

test('recall does not disclose hidden contrast or repair targets', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { contradicts: ['[[Hidden]]'], recall_repair_path: 'Hidden.md' });
    await seed('Hidden.md', { moderation_status: 'hidden' });
    const result = await wiki.recallQueue();
    expect(result.total).toBe(1);
    expect(JSON.stringify(result)).not.toContain('Hidden');
  });
});

test('recall resolves contrast wikilinks relative to their note', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Topic/Note.md', { contradicts: ['[[./Other.md]]'] });
    await seed('Topic/Other.md', { recall_prompt: undefined });
    await seed('Other.md', { recall_prompt: undefined });
    const result: any = await wiki.recallQueue();
    expect(result.items[0].contrastWith).toEqual([expect.objectContaining({ target: 'Topic/Other.md', revision: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
  });
});

test('recall refreshes sources hidden after discovery before counting', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md'); const scan = fs.iterateFreshNoteMetadata.bind(fs);
    vi.spyOn(fs, 'iterateFreshNoteMetadata').mockImplementation(async function* (...args) {
      for await (const note of scan(...args)) { await seed('Note.md', { moderation_status: 'hidden' }); yield note; }
    });
    expect(await wiki.recallQueue()).toMatchObject({ total: 0, items: [] });
  });
});

test('recall discovery never loads the unrestricted query inventory', async () => {
  await fixture(async ({ wiki, fs, seed, root }) => {
    await seed('Note.md');
    await writeFile(join(root, 'Oversized.md'), '# Oversized\n' + 'x'.repeat(MAX_NOTE_CONTENT_BYTES));
    const query = vi.spyOn(fs, 'queryNotes');
    await expect(wiki.recallQueue()).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

test('missing exact repair paths never fall back to a same-name note', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_repair_path: 'Repair.md' });
    await seed('Other/Repair.md', { recall_prompt: undefined });
    const result: any = await wiki.recallQueue();
    expect(result.items[0].repairPath).toBeUndefined();
    expect(result.items[0].repairState).toBe('unavailable');
  });
});

test('neighborhood whitespace does not change the authored diversity prefix', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('A.md', { domain: 'topic' });
    await seed('B.md', { domain: ' topic ' });
    await seed('C.md', { domain: 'other' });
    const result = await wiki.recallQueue(undefined, 2, 12000);
    expect(result.items.map(item => item.path)).toEqual(['A.md', 'C.md']);
  });
});

test.each(['source', 'private', 'missing-private'])('recall rejects %s drift after metadata admission', async mode => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md');
    if (mode === 'private') await seed(privatePath, { llm_wiki_type: 'agent_state', recall_quality: 'failed' });
    const read = fs.readNoteMetadata.bind(fs); let changed = false, admissions = 0;
    const target = mode === 'source' ? 'Note.md' : privatePath;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!changed && args[0].includes(target) && ++admissions === (mode === 'source' ? 2 : 1)) { changed = true; await seed(target, mode === 'source' ? { recall_prompt: 'CHANGED' } : { llm_wiki_type: 'agent_state', recall_quality: 'good' }); }
      return result;
    });
    await expect(wiki.recallQueue(mode === 'source' ? undefined : principal)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test('private recall reads bounded metadata, not answer or private record bodies', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md'); await seed(privatePath, { llm_wiki_type: 'agent_state', recall_quality: 'failed' });
    const read = vi.spyOn(fs, 'readNote'), metadata = vi.spyOn(fs, 'readNoteMetadata');
    await wiki.recallQueue(principal);
    expect(read).not.toHaveBeenCalled();
    expect(metadata.mock.calls.some(([paths, , options]) => paths.includes(privatePath) && options?.maxBytes === MAX_NOTE_CONTENT_BYTES && options.fresh && options.strict)).toBe(true);
  });
});

test.each(['contrast', 'repair'])('recall rejects %s target drift before returning its pointer', async kind => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', kind === 'contrast' ? { contradicts: ['[[Target.md]]'] } : { recall_repair_path: 'Target.md' });
    await seed('Target.md', { llm_wiki_type: 'other', recall_prompt: undefined });
    const read = fs.readNoteMetadata.bind(fs); let changed = false, admissions = 0;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!changed && args[0].includes('Target.md') && ++admissions === 2) { changed = true; await seed('Target.md', { moderation_status: 'hidden' }); }
      return result;
    });
    await expect(wiki.recallQueue()).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test('private prompt-only records are visible only to their owning reader', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: undefined });
    await seed(privatePath, { llm_wiki_type: 'agent_state', recall_prompt: 'PRIVATE-QUESTION', recall_quality: 'failed' });
    const result: any = await wiki.recallQueue(principal);
    expect(result.items[0].recallPrompt).toBe('PRIVATE-QUESTION');
    expect(result.items[0].stateRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(await wiki.recallQueue()).toMatchObject({ items: [], total: 0 });
  });
});

test('oversized private prompt inspection targets the record, not the shared answer', async () => {
  await fixture(async ({ wiki, seed, access }) => {
    await seed('Note.md');
    const raw = await seed(privatePath, { llm_wiki_type: 'agent_state', recall_prompt: 'PRIVATE'.repeat(200) });
    const result: any = await wiki.recallQueue(principal);
    expect(result.items[0]).toMatchObject({ promptOmitted: true, nextAction: { endpointId: 'notes.read', arguments: {
      path: access.toPublicPath(privatePath), property: 'recall_prompt', expectedRevision: createHash('sha256').update(raw).digest('hex'),
    } } });
    expect(result.items[0].recallPrompt).toBeUndefined();
  });
});

test('oversized prompt continuation through MCP never reads the answer or other Properties', async () => {
  await fixture(async ({ wiki, seed, root }) => {
    const prompt = 'Long question "한글" 😀\n'.repeat(150);
    await seed('Note.md', { recall_prompt: prompt, summary: 'ANSWER-IN-PROPERTIES' });
    const action = (await wiki.recallQueue()).items[0]!.nextAction;
    expect(action.arguments.property).toBe('recall_prompt');
    const server = createServer(root, { version: 'recall-integrity' });
    const client = new Client({ name: 'prompt-reader', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      for (const prettyPrint of [false, true]) {
        let next = { ...action, arguments: { ...action.arguments, maxChars: 1200, prettyPrint } }, reconstructed = '';
        for (let page = 0; page < 40; page++) {
          const result = await client.callTool({ name: 'call_endpoint', arguments: next });
          expect(result.isError).not.toBe(true);
          const text = (result.content as any)[0].text;
          expect(text.length).toBeLessThanOrEqual(1200);
          expect(text).not.toContain('Do not reveal answer');
          expect(text).not.toContain('ANSWER-IN-PROPERTIES');
          const data = JSON.parse(text);
          expect(data.property).toBe('recall_prompt');
          reconstructed += data.value;
          if (!data.nextAction) break;
          expect(data.nextAction.arguments.expectedRevision).toBe(action.arguments.expectedRevision);
          expect(data.nextAction.arguments.offset).toBeGreaterThan(next.arguments.offset || 0);
          next = data.nextAction;
        }
        expect(reconstructed).toBe(prompt);
      }
      await seed('Note.md', { recall_prompt: 'Changed prompt' });
      const conflict = await client.callTool({ name: 'call_endpoint', arguments: action });
      expect(conflict.isError).toBe(true);
      expect(JSON.stringify(conflict)).not.toContain('Changed prompt');
      const restart = JSON.parse((conflict.content as any)[0].text).nextAction;
      expect(restart).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Note.md', property: 'recall_prompt', offset: 0 } });
      expect(restart.arguments.expectedRevision).not.toBe(action.arguments.expectedRevision);
      const restarted = await client.callTool({ name: 'call_endpoint', arguments: restart });
      expect(restarted.isError).not.toBe(true);
      expect(JSON.parse((restarted.content as any)[0].text)).toMatchObject({ value: 'Changed prompt', property: 'recall_prompt' });
      expect(JSON.stringify(restarted)).not.toContain('Answer');
    } finally { await client.close(); await server.close(); }
  });
});

test('review packet retains private invalid-interval repair when the recall task exceeds its old inner budget', async () => {
  await fixture(async ({ wiki, seed, access }) => {
    await seed('Note.md');
    await seed(privatePath, { llm_wiki_type: 'agent_state', recall_prompt: '"'.repeat(1000), recall_confusion: '"'.repeat(600),
      recall_interval_days: 1e300, recall_quality: 'failed', recall_repair_status: 'in_progress' });
    expect(await wiki.recallQueue(principal, 10, 3200)).toMatchObject({ items: [], retry: { overrides: { maxChars: 12000 } } });
    const result: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(result.curationPlan.selected.reason).toBe('invalid_recall_interval_days');
    expect(result.curationPlan.inspect.arguments.path).toBe(access.toPublicPath(privatePath));
    expect(result.curationPlan.then).toMatchObject({ endpointId: 'notes.patch', arguments: { path: access.toPublicPath(privatePath), dryRun: true } });
  });
});

test('property-only reads enforce visibility, bounded fresh metadata and guarded offsets', async () => {
  await fixture(async ({ seed, root }) => {
    await seed('Note.md', { scalar: 3, empty: '', recall_prompt: 'QUESTION' });
    await seed('Hidden.md', { moderation_status: 'hidden', recall_prompt: 'HIDDEN-QUESTION' });
    await seed(privatePath, { recall_prompt: 'PRIVATE-QUESTION' });
    await writeFile(join(root, 'Huge.md'), '---\nrecall_prompt: q\n---\n' + 'x'.repeat(MAX_NOTE_CONTENT_BYTES));
    const read = vi.spyOn(FileSystemService.prototype, 'readNote');
    const metadata = vi.spyOn(FileSystemService.prototype, 'readNoteMetadata');
    const server = createServer(root, { version: 'recall-integrity', readOnly: true });
    const client = new Client({ name: 'property-reader', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      const call = (args: Record<string, unknown>) => client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'notes.read', arguments: args } });
      for (const args of [
        { path: 'Hidden.md', property: 'recall_prompt' }, { path: privatePath, property: 'recall_prompt' },
        { path: '../Outside.md', property: 'recall_prompt' }, { path: 'Huge.md', property: 'recall_prompt' },
        { path: 'Note.md', property: 'missing' }, { path: 'Note.md', property: 'scalar' },
        { path: 'Note.md', property: 'toString' }, { path: 'Note.md', property: 'recall_prompt', offset: 1 },
        { path: 'Note.md', property: 'recall_prompt', offset: -1 }, { path: 'Note.md', offset: 1 },
      ]) {
        const result = await call(args);
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE-QUESTION|HIDDEN-QUESTION|Do not reveal answer/);
      }
      const result = await call({ path: 'Note.md', property: 'empty', maxChars: 512 });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({ value: '', truncated: false });
      expect(read).not.toHaveBeenCalled();
      expect(metadata).toHaveBeenCalledWith(['Note.md'], expect.any(Function), { fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
    } finally { await client.close(); await server.close(); }
  });
});

test('review packet does not repeat an unavailable recall task at the hard ceiling', async () => {
  await fixture(async ({ wiki }) => {
    vi.spyOn(wiki, 'recallQueue').mockResolvedValue({ items: [], total: 1, truncated: true, taskUnavailable: true,
      instruction: 'Exact task unavailable; narrow the authored question before retrying.' });
    const result: any = await wiki.reviewPacket(undefined, 10, 16000);
    const action = result.crossVaultActions.find((item: any) => item.reason === 'recall_task_needs_detail');
    expect(action.inspect).toMatchObject({ taskUnavailable: true });
    expect(action.inspect.endpointId).toBeUndefined();
  });
});

test('recall forwards pretty budgets through the fixed MCP executor', async () => {
  await fixture(async ({ seed, root }) => {
    await seed('Note.md', { title: 'Title '.repeat(100), recall_confusion: 'Confusion '.repeat(80) });
    const server = createServer(root, { version: 'recall-integrity' });
    const client = new Client({ name: 'recall-integrity', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(ct), server.connect(st)]);
      expect((await client.listTools()).tools).toHaveLength(5);
      for (const maxChars of [512, 1000, 12000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId: 'wiki.recall_queue', arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError).not.toBe(true);
        const text = (result.content as any)[0].text;
        expect(text.length).toBeLessThanOrEqual(maxChars);
        expect(JSON.parse(text).items[0]).toMatchObject({ path: 'Note.md', recallPrompt: 'Explain the mechanism.' });
      }
    } finally { await client.close(); await server.close(); }
  });
});

test('recall discovery and alias resolution never refresh an attached metadata index', async () => {
  await fixture(async ({ seed, root, access }) => {
    await seed('Note.md', { contradicts: ['[[Alternate]]'] });
    await seed('Other.md', { aliases: ['Alternate'], recall_prompt: undefined });
    const filter = new PathFilter(), frontmatter = new FrontmatterHandler();
    const index = new VaultMetadataIndex(root, filter, frontmatter);
    try {
      const list = vi.spyOn(index, 'list'), resolve = vi.spyOn(index, 'resolveNoteReference');
      const fs = new FileSystemService(root, filter, frontmatter, undefined, index);
      const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
      const result = await wiki.recallQueue();
      expect(result.items[0]?.contrastWith).toEqual([expect.objectContaining({ target: 'Other.md' })]);
      expect(list).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    } finally { await index.close(); }
  });
});

test('recall reference inspection stops at its metadata admission budget', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { contradicts: ['[[Unresolved alias]]'] });
    for (let i = 0; i < 260; i++) await seed(`Reference${i}.md`, { llm_wiki_type: 'other', recall_prompt: undefined });
    await expect(wiki.recallQueue()).rejects.toThrow(/inspection budget exhausted/i);
  });
});

test('foreign private oversized files do not enter the recall read budget', async () => {
  await fixture(async ({ wiki, seed, root }) => {
    await seed('Note.md');
    await seed('_scopes/agents/other/Hidden.md');
    await writeFile(join(root, '_scopes/agents/other/Hidden.md'), 'x'.repeat(MAX_NOTE_CONTENT_BYTES + 1));
    const result = await wiki.recallQueue(principal);
    expect(result.total).toBe(1);
    expect(JSON.stringify(result)).not.toContain('Hidden');
  });
});
