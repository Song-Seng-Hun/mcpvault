import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from './continuity.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

const vaults: string[] = [];
afterEach(async () => { for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });

test('continuity checkpoint is private, revisioned, and bounded', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const continuity = new ContinuityService(fs);
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };

  const saved = await continuity.save({ principal, topic: 'Search review', summary: 'The lexical search is bounded.', nextAction: 'Review semantic fallback.', openQuestions: ['Should the index be warmed lazily?'], focusQuestions: ['Which cache is authoritative?'], focusProjects: ['MCPVault scale-up'], focusNotes: ['[[Knowledge/Search]]'], pendingEdits: [{ path: 'Knowledge/Search.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch', purpose: 'Apply the reviewed summary without overwriting a peer edit.' }], researchTrail: [{ kind: 'query', summary: 'Looked for stale cache handling.' }, { kind: 'read', summary: 'The search note defines generation invalidation.', path: 'Knowledge/Search.md', revision: 'b'.repeat(64) }], cursors: { mention: 'mention-2' } });
  const resumed = await continuity.read({ principal, maxChars: 1200 });

  expect(saved.path).toBe('scope://agent/codex-worker/_continuity/work-state.md');
  expect(resumed.exists).toBe(true);
  expect(resumed.fm.topic).toBe('Search review');
  expect(resumed.fm.cursors).toEqual({ mention: 'mention-2' });
  expect(resumed.fm.focus_questions).toEqual(['Which cache is authoritative?']);
  expect(resumed.fm.focus_projects).toEqual(['MCPVault scale-up']);
  expect(resumed.fm.focus_notes).toEqual(['[[Knowledge/Search]]']);
  expect(resumed.fm.pending_edits).toEqual([{ path: 'Knowledge/Search.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch', purpose: 'Apply the reviewed summary without overwriting a peer edit.' }]);
  expect(resumed.fm.research_trail).toEqual([{ kind: 'query', summary: 'Looked for stale cache handling.' }, { kind: 'read', summary: 'The search note defines generation invalidation.', path: 'Knowledge/Search.md', revision: 'b'.repeat(64) }]);
  expect(resumed.content).toContain('Review semantic fallback.');
  expect(resumed.content).toContain('Top-of-mind questions');
  expect(resumed.content).toContain('Pending revision-checked edits');
  expect(resumed.content).toContain('Research trail');
  expect(await fs.noteExists('_scopes/agents/codex-worker/_continuity/work-state.md')).toBe(true);
});

test('continuity rejects incomplete pending edit guards', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const continuity = new ContinuityService(fs);
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', pendingEdits: [{ path: '../escape.md', expectedRevision: 'a'.repeat(64), endpointId: 'notes.patch' }] })).rejects.toThrow(/pendingEdit\.path/);
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', pendingEdits: [{ path: 'Knowledge/A.md', endpointId: 'notes.patch' }] })).rejects.toThrow(/expectedRevision/);
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', researchTrail: [{ kind: 'read', summary: 'Unsafe path', path: '../secret.md' }] })).rejects.toThrow(/researchTrail\.path/);
  await expect(continuity.save({ principal, topic: 'Interrupted edit', summary: 'One path was selected.', nextAction: 'Resume safely.', researchTrail: [{ kind: 'thought', summary: 'Hidden reasoning' }] })).rejects.toThrow(/researchTrail\.kind/);
});

test('learning progress resumes at the next MOC entry and blocks stale paths', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };
  let rootRevision = 'a'.repeat(64);
  let entries = [
    { path: 'Knowledge/A.md', revision: 'b'.repeat(64) },
    { path: 'Knowledge/B.md', revision: 'c'.repeat(64) },
    { path: 'Knowledge/C.md', revision: 'd'.repeat(64) },
  ];
  const buildLearningPath = vi.fn(async () => ({
    root: { path: 'Knowledge/MOC.md', revision: rootRevision },
    authoredOrder: entries,
    recommendedOrder: entries.map(item => item.path),
    summary: { entries: entries.length, omittedEntries: 0 },
  }));
  const continuity = new ContinuityService(fs, { buildLearningPath });

  const saved = await continuity.save({
    principal,
    topic: 'Read the curriculum',
    summary: 'The first note is complete.',
    nextAction: 'Resume the checked learning path.',
    learningProgress: { rootPath: 'Knowledge/MOC.md', order: 'authored', completedThrough: 'Knowledge/A.md' },
  });
  expect(saved.learningProgress).toMatchObject({ state: 'ready', completedCount: 1, next: { path: 'Knowledge/B.md', revision: 'c'.repeat(64), endpointId: 'notes.read' } });

  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'ready', canResume: true, completedCount: 1, next: { path: 'Knowledge/B.md' } });
  expect(resumed.fm.learning_progress).toBeUndefined();
  expect(resumed.content).toContain('Progress: 1/3');
  expect(buildLearningPath).toHaveBeenCalledWith(principal, 'Knowledge/MOC.md', 2, 50, 16000);

  const pulseView = await continuity.read({ principal, validateLearningProgress: false });
  expect(pulseView.learningProgress).toMatchObject({ state: 'saved_unchecked', revalidateWith: 'continuity.resume' });

  entries = entries.map(item => item.path === 'Knowledge/B.md' ? { ...item, revision: 'e'.repeat(64) } : item);
  const stale = await continuity.read({ principal });
  expect(stale.learningProgress).toMatchObject({
    state: 'stale', canResume: false,
    drift: { rootChanged: false, structureChanged: false, revisionsChanged: true, changedEntriesTotal: 1, changedEntries: [expect.objectContaining({ path: 'Knowledge/B.md', state: 'revised' })] },
    nextAction: { endpointId: 'wiki.learning_path' },
  });
  expect(stale.learningProgress.next).toBeUndefined();

  rootRevision = 'f'.repeat(64);
  entries = [...entries].reverse();
  const reordered = await continuity.read({ principal });
  expect(reordered.learningProgress).toMatchObject({ state: 'stale', drift: { rootChanged: true, structureChanged: true } });

  const completed = await continuity.save({
    principal, topic: 'Read the curriculum', summary: 'Every entry is complete.', nextAction: 'Close the learning route.',
    learningProgress: { rootPath: 'Knowledge/MOC.md', completedThrough: 'Knowledge/A.md' },
  });
  expect(completed.learningProgress).toMatchObject({ state: 'complete', complete: true, completedCount: 3, entriesTracked: 3 });
  expect(completed.learningProgress.next).toBeUndefined();
});

test('learning progress rejects inaccessible, incomplete, and unsafe sequences', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };
  let projection: Record<string, any> = {
    root: { path: 'Knowledge/MOC.md', revision: 'a'.repeat(64) },
    authoredOrder: [{ path: 'Knowledge/A.md', revision: 'b'.repeat(64) }],
    recommendedOrder: ['Knowledge/A.md'],
    summary: { entries: 1, omittedEntries: 0 },
  };
  const continuity = new ContinuityService(fs, { buildLearningPath: async () => projection });
  const base = { principal, topic: 'Learning', summary: 'Checkpoint.', nextAction: 'Resume.' };

  await expect(continuity.save({ ...base, learningProgress: { rootPath: 'scope://model/claude/Private.md' } })).rejects.toThrow(/private|Access denied/);
  await expect(continuity.save({ ...base, learningProgress: { rootPath: 'Knowledge/MOC.md', completedThrough: 'Knowledge/Unknown.md' } })).rejects.toThrow(/must be one entry/);
  projection = { ...projection, summary: { entries: 50, omittedEntries: 1 } };
  await expect(continuity.save({ ...base, learningProgress: { rootPath: 'Knowledge/MOC.md' } })).rejects.toThrow(/limited to 50 entries/);
  projection = { ...projection, authoredOrder: [{ path: 'Knowledge/A.md', revision: 'b'.repeat(64) }, { path: 'Knowledge/B.md', revision: 'c'.repeat(64) }], recommendedOrder: ['Knowledge/A.md'], summary: { entries: 2, omittedEntries: 0 } };
  await expect(continuity.save({ ...base, learningProgress: { rootPath: 'Knowledge/MOC.md', order: 'recommended' } })).rejects.toThrow(/omits cyclic or blocked entries/);
});
