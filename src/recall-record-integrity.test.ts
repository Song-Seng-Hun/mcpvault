import { test, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { FileSystemService, MAX_NOTE_CONTENT_BYTES } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

const principal = { accountId: 'reader', modelId: 'codex', agentId: 'recall-reader', role: 'agent' as const };
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const statePath = `_scopes/agents/recall-reader/_continuity/recall/${sha('note.md')}.md`;
async function fixture(run: (c: { fs: FileSystemService; wiki: LlmWikiService; root: string; revision: string;
  seed: (path: string, fields?: Record<string, unknown>) => Promise<string> }) => Promise<void>) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-record-recall-', root = await mkdtemp(join(base, prefix));
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy();
  const seed = async (path: string, fields: Record<string, unknown> = {}) => {
    const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', recall_prompt: 'Shared question?', ...fields })}---\n# Answer\nDo not disclose.\n`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw); return sha(raw);
  };
  try { await run({ fs, root, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)), seed, revision: await seed('Note.md') }); }
  finally {
    vi.restoreAllMocks(); const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test('private recall rejects stale knowledge revision without creating state', async () => {
  await fixture(async ({ wiki, fs, seed, revision }) => {
    await seed('Note.md', { recall_prompt: 'A changed question' });
    await expect(wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision })).rejects.toThrow(/revision/i);
    expect(await fs.noteExists(statePath)).toBe(false);
  });
});

test('source guard rejects a cooperating source change just before private persistence', async () => {
  await fixture(async ({ wiki, fs, seed, revision }) => {
    const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
    vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
      await seed('Note.md', { recall_prompt: 'Changed before writing' }); return write(params, guards, policy);
    });
    await expect(wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision })).rejects.toThrow(/revision/i);
    expect(await fs.noteExists(statePath)).toBe(false);
  });
});

test.each([undefined, 'missing', 'a'.repeat(64)])('existing private state rejects missing or stale guard %s', async guard => {
  await fixture(async ({ wiki, seed, root, revision }) => {
    await seed(statePath, { recall_prompt: 'Personal question', recall_interval_days: 20 });
    const before = await readFile(join(root, statePath), 'utf8');
    await expect(wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision,
      expectedStateRevision: guard } as any)).rejects.toThrow(/revision/i);
    expect(await readFile(join(root, statePath), 'utf8')).toBe(before);
  });
});

test('private-only question and cadence survive recording without shared defaults', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    const revision = await seed('Note.md', { recall_prompt: undefined, recall_interval_days: 1e300 });
    const stateRevision = await seed(statePath, { recall_prompt: 'Personal question', recall_interval_days: 20 });
    const result = await wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision, expectedStateRevision: stateRevision } as any);
    expect(result).toMatchObject({ recallPrompt: 'Personal question', recallIntervalDays: 20 });
    expect((await fs.readNote(statePath)).frontmatter).toMatchObject({ recall_prompt: 'Personal question', recall_interval_days: 20 });
  });
});

test('long inherited question is preserved, not silently rewritten into a prefix', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    const prompt = 'Long authored question? '.repeat(90), revision = await seed('Note.md', { recall_prompt: prompt });
    const result = await wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision });
    expect(result).toMatchObject({ promptOmitted: true });
    expect(result.recallPrompt).toBeUndefined();
    expect((await fs.readNote(statePath)).frontmatter.recall_prompt).toBe(prompt.trim());
  });
});

test('explicit oversized replacement is rejected without writing', async () => {
  await fixture(async ({ wiki, fs, revision }) => {
    await expect(wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision, recallPrompt: 'x'.repeat(1001) })).rejects.toThrow(/1000/);
    expect(await fs.noteExists(statePath)).toBe(false);
  });
});

test.each(['Note.md', statePath])('moderation-hidden recall source %s is not mutated', async path => {
  await fixture(async ({ wiki, seed, root, revision }) => {
    const hiddenRevision = await seed(path, { moderation_status: 'hidden' });
    const before = await readFile(join(root, path), 'utf8');
    await expect(wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: path === 'Note.md' ? hiddenRevision : revision,
      ...(path === statePath && { expectedStateRevision: hiddenRevision }) } as any)).rejects.toThrow(/unavailable|hidden/i);
    expect(await readFile(join(root, path), 'utf8')).toBe(before);
  });
});

test('private write receipt is not replaced by an intervening edit', async () => {
  await fixture(async ({ wiki, fs, seed, revision }) => {
    let ownRevision: string | undefined;
    const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
    vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
      const receipt = await write(params, guards, policy); ownRevision = receipt.revision;
      await seed(statePath, { recall_history: [{ quality: 'failed' }, { quality: 'failed' }], recall_success_count: 90 });
      return receipt;
    });
    const result = await wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision });
    expect(ownRevision).toBeDefined();
    expect(result).toMatchObject({ stateRevision: ownRevision, recallHistoryCount: 1, recallSuccessCount: 1 });
    expect((await fs.readNote(statePath)).revision).not.toBe(ownRevision);
  });
});

test('shared write returns its own receipt, not a later source revision', async () => {
  await fixture(async ({ wiki, fs, seed, revision }) => {
    let ownRevision: string | undefined;
    const update = fs.updateFrontmatterWithReceipt.bind(fs);
    vi.spyOn(fs, 'updateFrontmatterWithReceipt').mockImplementation(async (params, policy) => {
      const receipt = await update(params, policy); ownRevision = receipt.revision; await seed('Note.md', { recall_quality: 'failed' }); return receipt;
    });
    const result = await wiki.recordRecall({ path: 'Note.md', recallQuality: 'good', expectedRevision: revision });
    expect(ownRevision).toBeDefined(); expect(result.revision).toBe(ownRevision);
    expect((await fs.readNote('Note.md')).revision).not.toBe(ownRevision);
  });
});

test('recording uses bounded metadata and does not open answer or private record bodies', async () => {
  await fixture(async ({ wiki, fs, revision }) => {
    const read = vi.spyOn(fs, 'readNote'), metadata = vi.spyOn(fs, 'readNoteMetadata');
    await wiki.recordRecall({ principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision });
    expect(read).not.toHaveBeenCalled();
    expect(metadata).toHaveBeenCalledWith(['Note.md'], expect.any(Function), { fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
  });
});

test('revision guard refuses an oversized related source before changing its target', async () => {
  await fixture(async ({ fs, root, revision }) => {
    const raw = 'x'.repeat(MAX_NOTE_CONTENT_BYTES + 1);
    await writeFile(join(root, 'Guard.md'), raw);
    await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'Note.md', content: 'Unsafe change', expectedRevision: revision },
      [{ path: 'Guard.md', expectedRevision: sha(raw) }], { maxBytes: MAX_NOTE_CONTENT_BYTES })).rejects.toThrow();
    expect(await fs.readNoteRevision('Note.md')).toBe(revision);
  });
});

test('two first attempts cannot both replace missing private state', async () => {
  await fixture(async ({ wiki, fs, revision }) => {
    const args = { principal, path: 'Note.md', recallQuality: 'good', expectedRevision: revision };
    const results = await Promise.allSettled([wiki.recordRecall(args), wiki.recordRecall(args)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await fs.readNote(statePath)).frontmatter.recall_history).toHaveLength(1);
  });
});

test('review packet forwards the private state guard into its record action', async () => {
  await fixture(async ({ wiki, seed }) => {
    const stateRevision = await seed(statePath, { llm_wiki_type: undefined, mcpvault_type: 'agent_recall_state', recall_quality: 'failed', recall_confusion: 'Need another attempt' });
    const result: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(result.curationPlan.selected.reason).toBe('active_recall_due');
    expect(result.curationPlan).toMatchObject({ then: { arguments: { expectedStateRevision: stateRevision } } });
  });
});

test.each(['shrink', 'trash'])('oversized existing notes still support revision-checked recovery: %s', async mode => {
  await fixture(async ({ fs, root }) => {
    const raw = 'x'.repeat(MAX_NOTE_CONTENT_BYTES + 1), path = 'Large.md';
    await writeFile(join(root, path), raw);
    if (mode === 'shrink') {
      await fs.writeNoteWithReceipt({ path, content: 'Recovered small note', expectedRevision: sha(raw) });
      expect((await fs.readNote(path)).content).toContain('Recovered small note');
    } else {
      const result = await fs.deleteNote({ path, confirmPath: path, expectedRevision: sha(raw), trashMode: 'local' });
      expect(result.success).toBe(true);
      expect(await fs.noteExists(path)).toBe(false);
      expect(sha(await readFile(join(root, '.trash', path), 'utf8'))).toBe(sha(raw));
    }
  });
});

test('shared recording bounds both its final revision guard and body-preserving Properties write', async () => {
  await fixture(async ({ wiki, fs, revision }) => {
    const hashRead = vi.spyOn(fs, 'readNoteRevision'), bodyRead = vi.spyOn(fs, 'readNote');
    await wiki.recordRecall({ path: 'Note.md', recallQuality: 'good', expectedRevision: revision });
    expect(hashRead).toHaveBeenCalledWith('Note.md', MAX_NOTE_CONTENT_BYTES);
    expect(bodyRead).toHaveBeenCalledWith('Note.md', MAX_NOTE_CONTENT_BYTES);
  });
});
