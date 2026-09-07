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
import { VaultGraphIndex } from './vault-graph.js';
import { PathFilter } from './pathfilter.js';
import { FrontmatterHandler } from './frontmatter.js';

const principal = { accountId: 'reader', modelId: 'codex', agentId: 'review-reader', role: 'agent' as const };
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');
const privatePath = `_scopes/agents/review-reader/_continuity/recall/${sha('note.md')}.md`;
async function fixture(run: (c: { wiki: LlmWikiService; fs: FileSystemService;
  seed: (path: string, fields?: Record<string, unknown>, content?: string) => Promise<string> }) => Promise<void>, sharedGraph = false) {
  const base = await realpath(tmpdir()), prefix = 'mcpvault-review-action-', root = await mkdtemp(join(base, prefix));
  const graph = sharedGraph ? new VaultGraphIndex(root, new PathFilter(), new FrontmatterHandler()) : undefined;
  const fs = new FileSystemService(root, undefined, undefined, undefined, undefined, graph), access = new ScopeAccessPolicy();
  const seed = async (path: string, fields: Record<string, unknown> = {}, content = '# Answer\nCurrent body\n') => {
    const raw = `---\n${stringify({ llm_wiki_type: path === privatePath ? 'agent_state' : 'knowledge',
      note_kind: 'atomic', lifecycle: 'evergreen', recall_prompt: 'Original question?', ...fields })}---\n${content}`;
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), raw);
    graph?.invalidate(path); return sha(raw);
  };
  try { await run({ fs, wiki: new LlmWikiService(fs, access, new ReferenceService(fs, access)), seed }); }
  finally {
    vi.restoreAllMocks(); graph?.close(); const target = await realpath(root), rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(target).startsWith(prefix)) throw new Error('Unsafe cleanup');
    await rm(target, { recursive: true, force: true });
  }
}

test.each(['source', 'private', 'missing-private', 'repair', 'hidden-source'])('review rejects %s drift after the real recall producer', async mode => {
  await fixture(async ({ wiki, seed }) => {
    await seed('Note.md', { recall_interval_days: 1 });
    if (mode === 'private' || mode === 'repair') await seed(privatePath, { recall_interval_days: 1,
      ...(mode === 'repair' && { last_recalled_at: 'bad-date' }) });
    const queue = wiki.recallQueue.bind(wiki);
    vi.spyOn(wiki, 'recallQueue').mockImplementation(async (...args) => {
      const result = await queue(...args);
      await seed(mode === 'source' || mode === 'hidden-source' ? 'Note.md' : privatePath,
        { recall_prompt: 'Changed question?', recall_interval_days: 30,
          ...(mode === 'hidden-source' && { moderation_status: 'hidden' }) });
      return result;
    });
    await expect(wiki.reviewPacket(principal, 10, 16000)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

// Isolate only independent report producers, not filesystem or action routing.
// This measures final-plan reads without counting legitimate graph/body work.
function isolateInbox(wiki: LlmWikiService, revision: string) {
  vi.spyOn(wiki as any, 'collectReviewDashboard').mockResolvedValue({ sections: {
    graph: {}, inbox: { items: [{ path: 'Note.md', revision }], total: 1 }, knowledge: { items: [], total: 0 },
  } });
  vi.spyOn(wiki, 'lint').mockResolvedValue({ issues: [], errors: 0, warnings: 0 } as any);
  vi.spyOn(wiki, 'recallQueue').mockResolvedValue({ items: [], total: 0, truncated: false });
  vi.spyOn(wiki, 'vocabularyHealth').mockResolvedValue({ tagVariants: [], unresolvedSubjectTerms: [], termCollisions: [] } as any);
  vi.spyOn(wiki, 'flowHealth').mockResolvedValue({ flow: {}, lanes: {} } as any);
}

function isolateOrphans(wiki: LlmWikiService) {
  isolateInbox(wiki, '');
  vi.mocked((wiki as any).collectReviewDashboard).mockResolvedValue({ sections: {
    graph: { orphanNotes: { total: 1, items: [{ path: 'Note.md' }] } },
    inbox: { items: [], total: 0 }, knowledge: { items: [], total: 0 },
  } });
}

test.each([
  ['Knowledge/Peer.md', false], ['Community/Posts/Peer.md', false],
  ['Knowledge/Peer.md', true], ['Community/Posts/Peer.md', true],
] as const)(
  'review rejects an incoming link from %s with shared graph=%s and unchanged target revision', async (source, sharedGraph) => {
    await fixture(async ({ wiki, fs, seed }) => {
      const revision = await seed('Note.md'); isolateOrphans(wiki);
      const read = fs.readNoteRevision.bind(fs); let linked = false;
      vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
        const result = await read(...args);
        if (!linked && args[0] === 'Note.md') {
          linked = true; await seed(source, {}, '[[Note]]\n');
        }
        return result;
      });
      await expect(wiki.reviewPacket(undefined, 1, 4000)).rejects.toThrow(/changed|refresh|unavailable/i);
      expect(linked).toBe(true);
      expect(await read('Note.md')).toBe(revision);
      expect((await fs.findOrphanNotes(10)).orphans.map(note => note.path)).not.toContain('Note.md');
    }, sharedGraph);
  },
);

test.each(['unrelated', 'private', 'hidden', 'fenced', 'self'])(
  'orphan review remains usable after %s graph activity', async mode => {
    await fixture(async ({ wiki, fs, seed }) => {
      const revision = await seed('Note.md', {}, mode === 'self' ? '[[Note]]\n' : '# Answer\n');
      isolateOrphans(wiki);
      const read = fs.readNoteRevision.bind(fs); let changed = false;
      vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
        const result = await read(...args);
        if (!changed && args[0] === 'Note.md') {
          changed = true;
          await seed(mode === 'private' ? '_scopes/agents/someone-else/Secret.md' : 'Community/Posts/Peer.md',
            mode === 'hidden' ? { moderation_status: 'hidden' } : {},
            mode === 'fenced' ? '```md\n[[Note]]\n```\n' : mode === 'private' || mode === 'hidden' ? '[[Note]]\n' : '# Unrelated activity\n');
        }
        return result;
      });
      const result: any = await wiki.reviewPacket(undefined, 1, 4000);
      expect(result.curationPlan.selected).toMatchObject({ path: 'Note.md', revision, reason: 'orphan_note' });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
      expect(JSON.stringify(result)).not.toContain('Secret');
      expect(changed).toBe(true);
    }, true);
  },
);

test('secondary orphan priorities are revalidated in one bounded graph query', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md'); await seed('Other.md'); isolateOrphans(wiki);
    const read = fs.readNoteRevision.bind(fs); let linked = false;
    vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!linked && args[0] === 'Other.md') {
        linked = true; await seed('Community/Posts/Peer.md', {}, '[[Other]]\n');
      }
      return result;
    });
    const queries = vi.spyOn(fs, 'findOrphanNotes');
    await expect(wiki.reviewPacket(undefined, 2, 7000)).rejects.toThrow(/changed|refresh|unavailable/i);
    expect(queries).toHaveBeenCalledTimes(2);
    expect(queries.mock.calls[1]?.[0]).toBe(2);
    expect(queries.mock.calls[1]?.[3]?.includeCandidate?.('Community/Posts/Peer.md')).toBe(false);
    expect(queries.mock.calls[1]?.[1]?.('Community/Posts/Peer.md')).toBe(true);
  }, true);
});

test('a failed final orphan graph read returns only the bounded refresh error', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    await seed('Note.md'); isolateOrphans(wiki);
    const find = fs.findOrphanNotes.bind(fs); let calls = 0;
    vi.spyOn(fs, 'findOrphanNotes').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('Private graph details must not escape');
      return find(...args);
    });
    await expect(wiki.reviewPacket(undefined, 1, 512)).rejects.toThrow(
      /^Review inputs changed or became unavailable; refresh the packet and retry\.$/);
    expect(calls).toBe(2);
  });
});

test('action routing reuses fresh metadata and hash guards without selected body/existence reads', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    const revision = await seed('Note.md'); isolateInbox(wiki, revision);
    const bodies = vi.spyOn(fs, 'readNote'), exists = vi.spyOn(fs, 'noteExists');
    const orphans = vi.spyOn(fs, 'findOrphanNotes');
    const metadata = vi.spyOn(fs, 'readNoteMetadata'), hashes = vi.spyOn(fs, 'readNoteRevision');
    const result: any = await wiki.reviewPacket(undefined, 10, 16000);
    expect(result.curationPlan).toMatchObject({ selected: { path: 'Note.md', revision },
      then: { endpointId: 'wiki.clarify', arguments: { expectedRevision: revision } } });
    expect(bodies).not.toHaveBeenCalled(); expect(exists).not.toHaveBeenCalled();
    expect(orphans).not.toHaveBeenCalled();
    expect(metadata.mock.calls[0]?.[2]).toMatchObject({ fresh: true, strict: true, maxBytes: MAX_NOTE_CONTENT_BYTES });
    expect(hashes).toHaveBeenCalledWith('Note.md', MAX_NOTE_CONTENT_BYTES);
  });
});

test('source changed after candidate admission cannot keep the old plan', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    const revision = await seed('Note.md'); isolateInbox(wiki, revision);
    const read = fs.readNoteMetadata.bind(fs); let changed = false;
    vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
      const result = await read(...args);
      if (!changed) { changed = true; await seed('Note.md', { recall_prompt: 'Changed after admission' }); }
      return result;
    });
    await expect(wiki.reviewPacket(undefined, 10, 16000)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test('a producer revision conflict cannot be replaced by the newest metadata revision', async () => {
  await fixture(async ({ wiki, seed }) => {
    const old = await seed('Note.md'); isolateInbox(wiki, old);
    await seed('Note.md', { title: 'Changed' });
    await expect(wiki.reviewPacket(undefined, 10, 16000)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});

test('one final hash read covers identical source observations from multiple producers', async () => {
  await fixture(async ({ wiki, fs, seed }) => {
    const revision = await seed('Note.md'); isolateInbox(wiki, revision);
    vi.mocked(wiki.recallQueue).mockResolvedValue({ items: [{ path: 'Note.md', revision, recallPrompt: 'Original question?',
      reason: 'never_recalled', stateRevision: 'missing' }], total: 1, truncated: false });
    const hashes = vi.spyOn(fs, 'readNoteRevision'), metadata = vi.spyOn(fs, 'readNoteMetadata');
    const result: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(result.curationPlan.selected.revision).toBe(revision);
    expect(hashes.mock.calls.filter(([path]) => path === 'Note.md')).toHaveLength(1);
    expect(metadata.mock.calls.filter(([paths]) => paths.includes(privatePath))).toHaveLength(1);
  });
});

test.each([false, true])('unchanged real recall stays actionable with existing private state=%s', async hasState => {
  await fixture(async ({ wiki, seed }) => {
    const revision = await seed('Note.md');
    const stateRevision = hasState ? await seed(privatePath, { recall_prompt: 'Personal question?' }) : 'missing';
    const result: any = await wiki.reviewPacket(principal, 10, 16000);
    expect(result.curationPlan).toMatchObject({
      selected: { path: 'Note.md', revision },
      then: { endpointId: 'wiki.record_recall', arguments: { expectedRevision: revision, expectedStateRevision: stateRevision } },
    });
    expect(result.priorities).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'Note.md', recallPrompt: hasState ? 'Personal question?' : 'Original question?',
    })]));
  });
});

test('two producers cannot silently coalesce conflicting observations of one source', async () => {
  await fixture(async ({ wiki, seed }) => {
    const revision = await seed('Note.md'); isolateInbox(wiki, revision);
    vi.mocked(wiki.recallQueue).mockResolvedValue({ items: [{ path: 'Note.md', revision: 'f'.repeat(64),
      recallPrompt: 'Other observation', reason: 'never_recalled', stateRevision: 'missing' }], total: 1, truncated: false });
    await expect(wiki.reviewPacket(principal, 10, 16000)).rejects.toThrow(/changed|refresh|unavailable/i);
  });
});
