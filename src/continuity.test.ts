import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from './continuity.js';
import { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { ScopeAccessPolicy } from './scope-access.js';

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
    sourceRevisionFingerprint: 'e'.repeat(64),
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

test('real MOC relocation keeps a usable checkpoint recovery path without certifying old progress', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (principal, path, depth, limit, chars) => wiki.learningPath(principal, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'MOC.md', content: '# Map\n[[A.md]]\n[[B.md]]\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge' } });
  await continuity.save({ principal, topic: 'Learn', summary: 'Read A', nextAction: 'Read B', learningProgress: { rootPath: 'MOC.md', completedThrough: 'A.md' } });
  const checkpointPath = '_scopes/agents/worker/_continuity/work-state.md';
  const before = (await fs.readNote(checkpointPath)).frontmatter.learning_progress;
  const canAccess = (path: string) => access.canAccessPhysicalPath(path, principal);
  expect((await fs.moveNote({ oldPath: 'MOC.md', newPath: 'Renamed.md', updateLinks: true, expectedRevision: (await fs.readNote('MOC.md')).revision }, canAccess)).success).toBe(true);
  const stored = (await fs.readNote(checkpointPath)).frontmatter.learning_progress;
  expect(stored.root_path).toBe('Renamed.md');
  expect(stored.root_revision).toBe(before.root_revision);
  expect(stored.structure_fingerprint).toBe(before.structure_fingerprint);
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false, completedThrough: 'A.md', nextAction: { endpointId: 'wiki.learning_path', arguments: { path: 'Renamed.md' } } });
  expect(resumed.learningProgress.next).toBeUndefined();
  expect(resumed.learningProgress.drift.validationError).toBeUndefined();
});

test.each(['cycle', 'truncated'])('real learning checkpoints reject a %s recommended sequence', async scenario => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (principal, path, depth, limit, chars) => wiki.learningPath(principal, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'MOC.md', content: scenario === 'cycle' ? '# Map\n[[A.md]]\n[[B.md]]\n' : '# Map\n' + '[[A.md]]\n'.repeat(200) + '[[B.md]]\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', ...(scenario === 'cycle' && { depends_on: [path === 'A.md' ? '[[B.md]]' : '[[A.md]]'] }) } });
  await expect(continuity.save({ principal, topic: 'Learn', summary: 'Read A', nextAction: 'Read B', learningProgress: { rootPath: 'MOC.md', order: 'recommended', completedThrough: 'A.md' } })).rejects.toThrow(scenario === 'cycle' ? /cyclic or blocked/ : /truncated|incomplete/);
  expect(await fs.exists('_scopes/agents/worker/_continuity/work-state.md')).toBe(false);
  if (scenario === 'cycle') {
    const authored = await continuity.save({ principal, topic: 'Read authored route', summary: 'Read A despite the cycle', nextAction: 'Inspect B and repair the cycle', learningProgress: { rootPath: 'MOC.md', order: 'authored', completedThrough: 'A.md' } });
    expect(authored.learningProgress).toMatchObject({ state: 'ready', next: { path: 'B.md' } });
  }
});

test.each(['cycle', 'truncated'])('resuming after a %s path change preserves the checkpoint and withholds the next read', async scenario => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (principal, path, depth, limit, chars) => wiki.learningPath(principal, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'MOC.md', content: '# Map\n[[A.md]]\n[[B.md]]\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge' } });
  await continuity.save({ principal, topic: 'Learn', summary: 'Read A', nextAction: 'Read B', learningProgress: { rootPath: 'MOC.md', order: 'recommended', completedThrough: 'A.md' } });
  const checkpoint = '_scopes/agents/worker/_continuity/work-state.md';
  const before = await fs.readNote(checkpoint);
  if (scenario === 'cycle') {
    for (const path of ['A.md', 'B.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', depends_on: [path === 'A.md' ? '[[B.md]]' : '[[A.md]]'] }, expectedRevision: (await fs.readNote(path)).revision });
  } else {
    await fs.writeNote({ path: 'MOC.md', content: '# Map\n' + '[[A.md]]\n'.repeat(200) + '[[B.md]]\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' }, expectedRevision: (await fs.readNote('MOC.md')).revision });
  }
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false, nextAction: { endpointId: 'wiki.learning_path' } });
  expect(resumed.learningProgress.next).toBeUndefined();
  expect(resumed.learningProgress.drift.validationError).toMatch(scenario === 'cycle' ? /cyclic or blocked/ : /truncated|incomplete/);
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test.each(['note', 'claim'])('oversized %s prerequisites cannot hide a cycle from save or resume', async kind => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (principal, path, depth, limit, chars) => wiki.learningPath(principal, path, depth, limit, chars, true) });
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await fs.writeNote({ path: 'MOC.md', content: '# Map\n[[A.md]]\n[[B.md]]\n[[C.md]]\n', frontmatter: { note_kind: 'moc', llm_wiki_type: 'knowledge' } });
  const base = { note_kind: 'atomic', llm_wiki_type: 'knowledge', claims: [{ id: 'claim', text: 'Claim.' }] };
  for (const path of ['A.md', 'B.md', 'C.md']) await fs.writeNote({ path, content: '# Entry\n', frontmatter: base });
  const save = { principal, topic: 'Learn', summary: 'Read C', nextAction: 'Review path', learningProgress: { rootPath: 'MOC.md', order: 'recommended', completedThrough: 'C.md' } };
  const dependencies = (targets: string[]) => kind === 'note'
    ? { depends_on: targets.map(path => `[[${path}]]`) }
    : { claims: [{ id: 'claim', text: 'Claim.', depends_on_claims: targets.map(path => `[[${path}#^claim]]`) }] };
  await fs.writeNote({ path: 'A.md', content: '# Entry\n', frontmatter: { ...base, ...dependencies(Array(kind === 'note' ? 30 : 20).fill('B.md')) }, expectedRevision: (await fs.readNote('A.md')).revision });
  await continuity.save(save);
  const checkpoint = '_scopes/agents/worker/_continuity/work-state.md';
  const before = await fs.readNote(checkpoint);
  await fs.writeNote({ path: 'A.md', content: '# Entry\n', frontmatter: { ...base, ...dependencies([...Array(kind === 'note' ? 30 : 20).fill('B.md'), 'C.md']) }, expectedRevision: (await fs.readNote('A.md')).revision });
  await fs.writeNote({ path: 'C.md', content: '# Entry\n', frontmatter: { ...base, ...dependencies(['A.md']) }, expectedRevision: (await fs.readNote('C.md')).revision });
  const projection = await wiki.learningPath(principal, 'MOC.md', 2, 50, 16000, true);
  expect(projection.truncated).toBe(true);
  const diagnostic = await wiki.learningPath(principal, 'MOC.md', 2, 50, 16000);
  expect(diagnostic.prerequisiteCoverageComplete).toBe(false);
  expect(diagnostic.orderIssues).toEqual(expect.arrayContaining([expect.objectContaining({ type: kind === 'note' ? 'note_prerequisites_truncated' : 'claim_prerequisites_truncated' })]));
  await expect(continuity.save({ ...save, expectedRevision: before.revision })).rejects.toThrow(/truncated|incomplete/);
  const resumed = await continuity.read({ principal });
  expect(resumed.learningProgress).toMatchObject({ state: 'stale', canResume: false });
  expect(resumed.learningProgress.drift.validationError).toMatch(/truncated|incomplete/);
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('learning progress rejects inaccessible, incomplete, and unsafe sequences', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-continuity-'));
  vaults.push(vault);
  const fs = new FileSystemService(vault, new PathFilter(), new FrontmatterHandler());
  const principal = { accountId: 'codex-account', modelId: 'codex', agentId: 'codex-worker', role: 'agent' as const, capabilities: ['journal'] as const };
  let projection: Record<string, any> = {
    sourceRevisionFingerprint: 'e'.repeat(64),
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
