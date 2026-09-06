import { test, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const principal = { accountId: 'reader', modelId: 'codex', agentId: 'gap-reader', role: 'agent' as const };
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const statePath = `_scopes/agents/gap-reader/_continuity/recall/${sha('note.md')}.md`;
async function fixture(run: (c: { fs: FileSystemService; wiki: LlmWikiService;
  seed: (path: string, fields?: Record<string, unknown>) => Promise<string> }) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-gap-recall-', root = await mkdtemp(join(base, prefix));
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const seed = async (path: string, fields: Record<string, unknown> = {}) => {
    const raw = `---\n${stringify({ llm_wiki_type: path === 'Note.md' ? 'knowledge' : 'agent_state', note_kind: 'atomic', ...fields })}---\n# Answer\nANSWER-MUST-NOT-LEAK\n`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw); return sha(raw);
  };
  try { await run({ fs, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)), seed }); }
  finally {
    vi.restoreAllMocks(); const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('gap queue discovers private-only questions and returns both recording guards', async () => {
  await fixture(async ({ wiki, seed }) => {
    const revision = await seed('Note.md');
    const stateRevision = await seed(statePath, { recall_prompt: 'Private question?', recall_interval_days: 1 });
    const result = await wiki.knowledgeGaps(principal);
    expect(result.items[0]).toMatchObject({ path: 'Note.md', recallPrompt: 'Private question?', reasons: ['recall_due'], revision, stateRevision });
    expect(JSON.stringify(result)).not.toContain('ANSWER-MUST-NOT-LEAK');
  });
});

test('private cadence suppresses premature shared-cadence recall', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    await seed(statePath, { recall_prompt: 'Personal?', recall_interval_days: 30, last_recalled_at: new Date(Date.now() - 2 * 86400000).toISOString() });
    expect((await wiki.knowledgeGaps(principal)).total).toBe(0);
  });
});

test('shared history never pretends an unseen agent has already recalled', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 30, last_recalled_at: '2999-01-01' });
    const item = (await wiki.knowledgeGaps(principal)).items[0];
    expect(item).toMatchObject({ stateRevision: 'missing', reasons: ['recall_due'] });
    expect(item.lastRecalledAt).toBeUndefined();
  });
});

test('hidden private state and other-agent state never affect output', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { note_kind: 'question', epistemic_status: 'open', recall_prompt: 'Shared?', recall_interval_days: 1 });
    await seed(statePath, { moderation_status: 'hidden', recall_prompt: 'HIDDEN-QUESTION', last_recalled_at: '2999-01-01', recall_quality: 'HIDDEN-QUALITY' });
    await seed(statePath.replace('gap-reader', 'other'), { recall_prompt: 'OTHER-QUESTION', last_recalled_at: '2999-01-01' });
    const result = await wiki.knowledgeGaps(principal);
    expect(result.total).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/HIDDEN-|OTHER-/);
    expect(result.items[0]).toMatchObject({ recallUnavailable: true, reasons: ['question_open'], priority: 2 });
    expect(result.items[0].stateRevision).toBeUndefined();
  });
});

test('unavailable private recall cannot displace an actionable research question', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    await seed(statePath, { moderation_status: 'hidden', last_recalled_at: '2999-01-01' });
    await seed('Question.md', { llm_wiki_type: 'knowledge', note_kind: 'question', epistemic_status: 'open' });
    const result = await wiki.knowledgeGaps(principal, 1);
    expect(result).toMatchObject({ total: 1, truncated: false });
    expect(result.items[0]).toMatchObject({ path: 'Question.md', reasons: ['question_open'] });
  });
});

test.each([0, 4000, ['1']].map(value => [value]))('malformed interval %j requests repair without an invented due time', async interval => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Explain?', recall_interval_days: interval });
    const item = (await wiki.knowledgeGaps()).items[0];
    expect(item?.reasons).toContain('invalid_recall_interval_days');
    expect(item?.reasons).not.toContain('recall_due');
  });
});

test('long personal question uses revision-pinned prompt-only read, never a prefix', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    const stateRevision = await seed(statePath, { recall_prompt: 'Personal question '.repeat(100), recall_interval_days: 1 });
    const item = (await wiki.knowledgeGaps(principal, 10, 16000)).items[0];
    expect(item).toMatchObject({ promptOmitted: true, promptAction: { endpointId: 'notes.read', arguments: { expectedRevision: stateRevision, property: 'recall_prompt' } } });
    expect(item.recallPrompt).toBeUndefined();
  });
});

test('gap scan uses fresh bounded metadata without query index or private body reads', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    await seed(statePath, { recall_prompt: 'Private?', recall_interval_days: 1 });
    const body = vi.spyOn(fs, 'readNote'), query = vi.spyOn(fs, 'queryNotes');
    const read = fs.readNoteMetadata.bind(fs), policies: unknown[] = [];
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation((paths, access, options) => { policies.push(options); return read(paths, access, options); });
    expect((await wiki.knowledgeGaps(principal)).total).toBe(1);
    expect(body).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toMatchObject({ fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
  });
});

test('private storage failure is unavailable rather than unseen recall', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    const read = fs.readNoteMetadata.bind(fs);
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation((paths, access, options) => {
      if (paths.includes(statePath)) throw new Error('simulated disk failure');
      return read(paths, access, options);
    });
    await expect(wiki.knowledgeGaps(principal)).rejects.toThrow(/unavailable|refresh/i);
  });
});

test.each(['Note.md', statePath])('selected input changing during the scan is rejected: %s', async changingPath => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    await seed(statePath, { recall_prompt: 'Private?', recall_interval_days: 1 });
    const read = fs.readNoteMetadata.bind(fs); let changed = false;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (paths, access, options) => {
      const result = await read(paths, access, options);
      if (!changed && paths.includes(statePath)) { changed = true; await seed(changingPath, { recall_prompt: 'Changed?', recall_interval_days: 1 }); }
      return result;
    });
    await expect(wiki.knowledgeGaps(principal)).rejects.toThrow(/changed|refresh/i);
  });
});

test.each([false, true])('whole gap response obeys minimum budget, pretty=%s, with actionable retry', async pretty => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_prompt: 'Question '.repeat(80), recall_interval_days: 1 });
    const result: any = await (wiki.knowledgeGaps as any)(principal, 10, 512, pretty);
    expect(JSON.stringify(result, null, pretty ? 2 : undefined).length).toBeLessThanOrEqual(512);
    expect(result.retry).toMatchObject({ endpointId: 'wiki.knowledge_gaps', reuseOriginalArguments: true, overrides: { maxChars: 16000 } });
  });
});

test('new private state appearing after observed absence invalidates the selected task', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', { recall_prompt: 'Shared?', recall_interval_days: 1 });
    const read = fs.readNoteMetadata.bind(fs); let appeared = false;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (paths, access, options) => {
      const result = await read(paths, access, options);
      if (!appeared && paths.includes(statePath)) {
        appeared = true; await seed(statePath, { recall_prompt: 'New personal?', recall_interval_days: 30, last_recalled_at: '2999-01-01' });
      }
      return result;
    });
    await expect(wiki.knowledgeGaps(principal)).rejects.toThrow(/changed|refresh/i);
  });
});

test('hidden and other-scope knowledge does not affect gap totals or metadata reads', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md', { moderation_status: 'hidden', recall_prompt: 'HIDDEN', recall_interval_days: 1 });
    await seed('_scopes/agents/other/Secret.md', { llm_wiki_type: 'knowledge', note_kind: 'question', epistemic_status: 'open', title: 'SECRET' });
    const lookup = vi.spyOn(fs, 'readNoteMetadata');
    const result = await wiki.knowledgeGaps(principal);
    expect(result.total).toBe(0);
    expect(JSON.stringify(lookup.mock.calls)).not.toContain('Secret.md');
  });
});

test.each([false, true])('maximum-budget oversized first row never loops or skips to a lower priority, pretty=%s', async pretty => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { title: 'x'.repeat(20000), knowledge_status: 'disputed' });
    await seed('Lower.md', { llm_wiki_type: 'knowledge', note_kind: 'question', epistemic_status: 'open' });
    const result: any = await wiki.knowledgeGaps(principal, 10, 16000, pretty);
    expect(result).toMatchObject({ items: [], total: 2, truncated: true, taskUnavailable: true });
    expect(result.retry).toBeUndefined();
    expect(JSON.stringify(result, null, pretty ? 2 : undefined).length).toBeLessThanOrEqual(16000);
  });
});

test('epistemic task ranking and snoozes remain intact with bounded candidate count', async () => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { knowledge_status: 'disputed' });
    await seed('Question.md', { llm_wiki_type: 'knowledge', note_kind: 'question', epistemic_status: 'open' });
    await seed('Snoozed.md', { llm_wiki_type: 'knowledge', knowledge_status: 'disputed', review_snoozed_until: '2999-01-01' });
    const result = await wiki.knowledgeGaps(principal, 1);
    expect(result).toMatchObject({ total: 2, truncated: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ path: 'Note.md', reasons: ['disputed_claim'] });
  });
});
