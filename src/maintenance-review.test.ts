import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { MaintenanceReviewService, MAINTENANCE_REVIEW_LIMITS } from './maintenance-review.js';
import type { ExceptionBoardItem } from './exception-board.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, review: MaintenanceReviewService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'maintenance-review-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy();
  review = new MaintenanceReviewService(fs, access);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, raw: string) {
  await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), raw);
}
async function issue(path: string, code: string, category = 'knowledge_quality'): Promise<ExceptionBoardItem> {
  return { path, code, category, revision: (await fs.readNote(path)).revision,
    severity: 'warning', state: 'open', sourceState: 'snapshot_matched', suggestedAction: 'inspect', detail: 'Review the current source.',
    nextAction: { endpointId: 'notes.read', arguments: { path, maxChars: 3000 } } };
}
const ordinary = '---\nllm_wiki_type: knowledge\nnote_kind: atomic\n---\n# Current\nA current note.';

test('same-note warnings group once, with deterministic rule and revision identity', async () => {
  await seed('A.md', ordinary);
  const one = await issue('A.md', 'invalid_lifecycle', 'validation');
  const two = await issue('A.md', 'missing_evidence');
  const a = await review.group([one, two, one], undefined, 20, 12000);
  const b = await review.group([two, one], undefined, 20, 12000);
  expect(a.groups).toHaveLength(1);
  expect(a.groups[0]!.issues).toHaveLength(2);
  expect(a.groups[0]!.issueId).toBe(b.groups[0]!.issueId);
  expect(a.groups[0]!.ruleVersion).toBeDefined();
  expect(a.groups[0]!.nextAction.arguments.expectedRevision).toBe(one.revision);
  expect(a.coverage).toBe('partial');
});

test.each([1, 20])('read admission preserves a fully validated subset of 20 owners at requested limit %i', async limit => {
  const candidates: ExceptionBoardItem[] = [];
  for (let i = 0; i < 20; i++) {
    const sources = Array.from({ length: 5 }, (_, j) => `Source${i}-${j}.md`);
    for (const path of sources) await seed(path, '# Evidence\nUnchanged source.');
    const path = `Owner${String(i).padStart(2, '0')}.md`;
    await seed(path, `---\nevidence_paths: [${sources.join(', ')}]\n---\nCurrent owner.`);
    candidates.push(await issue(path, 'missing_evidence'));
  }
  const result = await review.group(candidates, undefined, limit, 16000);
  expect(result.groups.length).toBeGreaterThan(0); expect(result.groups.length).toBeLessThanOrEqual(limit);
  expect(result.groups[0]!.path).toBe('Owner00.md'); expect(result.groups[0]!.dependenciesComplete).toBe(true);
  expect(result.groups[0]!.affectedEvidence).toHaveLength(5);
});

test('fixed tiers rank integrity then evidence then navigation then tidying', async () => {
  const names = ['Tidy.md', 'Navigation.md', 'Evidence.md', 'Integrity.md'] as const;
  for (const name of names) await seed(name, ordinary);
  const board = await review.group([
    await issue(names[0], 'missing_summary'), await issue(names[1], 'broken_link', 'navigation'),
    await issue(names[2], 'stale_evidence', 'freshness'), await issue(names[3], 'unsafe_path', 'validation'),
  ], undefined, 20, 12000);
  expect(board.groups.map((g: any) => g.path)).toEqual([...names].reverse());
});

test('visible evidence revision changes invalidate stable review basis', async () => {
  await seed('A.md', '---\nllm_wiki_type: knowledge\nevidence_paths: [Source.md]\n---\nA conclusion.');
  await seed('Source.md', '# Evidence\nVersion one.');
  const signals = [await issue('A.md', 'stale_evidence')];
  const before = await review.group(signals, undefined, 20, 12000);
  await seed('Source.md', '# Evidence\nVersion two.');
  const after = await review.group(signals, undefined, 20, 12000);
  expect(after.groups[0]!.issueId).not.toBe(before.groups[0]!.issueId);
  expect(after.groups[0]!.reviewBasis).not.toBe(before.groups[0]!.reviewBasis);
});

test('snooze uses the current review basis but does not hide changed evidence', async () => {
  await seed('A.md', '---\nllm_wiki_type: knowledge\nevidence_paths: [Source.md]\n---\nA conclusion.');
  await seed('Source.md', '# Evidence\nVersion one.');
  const first = await review.group([await issue('A.md', 'stale_evidence')], undefined, 20, 12000);
  const current = await fs.readNote('A.md');
  await fs.updateFrontmatter({ path: 'A.md', expectedRevision: current.revision, merge: true,
    frontmatter: { review_snoozed_until: '2099-01-01T00:00:00.000Z', maintenance_review_basis: first.groups[0]!.reviewBasis } });
  const snoozed = await review.group([await issue('A.md', 'stale_evidence')], undefined, 20, 12000);
  expect(snoozed.groups[0]!.reviewState).toBe('snoozed');
  await seed('Source.md', '# Evidence\nChanged again.');
  const changed = await review.group([await issue('A.md', 'stale_evidence')], undefined, 20, 12000);
  expect(changed.groups[0]!.reviewState).toBe('recheck_required');
});

test.each(['body', 'references'])('a changed %s linked source invalidates its existing review deferral', async kind => {
  await seed('A.md', `---\nllm_wiki_type: knowledge\nreview_policy: on_link_change\n${kind === 'references' ? 'references: [Source.md]\n' : ''}---\nA conclusion.\n${kind === 'body' ? '[[Source.md]]' : ''}`);
  await seed('Source.md', '# Evidence\nFirst.');
  const first = await review.group([await issue('A.md', 'invalid_lifecycle')], undefined, 20, 12000);
  await fs.updateFrontmatter({ path: 'A.md', merge: true, expectedRevision: (await fs.readNote('A.md')).revision,
    frontmatter: { review_snoozed_until: '2099-01-01T00:00:00.000Z', maintenance_review_basis: first.groups[0]!.reviewBasis } });
  expect((await review.group([await issue('A.md', 'invalid_lifecycle')], undefined, 20, 12000)).groups[0]!.reviewState).toBe('snoozed');
  await seed('Source.md', '# Evidence\nChanged.');
  const after = await review.group([await issue('A.md', 'invalid_lifecycle')], undefined, 20, 12000);
  expect(after.groups[0]!.reviewState).toBe('recheck_required');
  expect(after.groups[0]!.reviewBasis).not.toBe(first.groups[0]!.reviewBasis);
});

test('author-marked completion never resolves a still-failing check', async () => {
  await seed('A.md', ordinary.replace('note_kind: atomic', 'note_kind: atomic\nlast_review_outcome: confirmed\nlast_reviewed_at: 2026-09-12'));
  const board = await review.group([await issue('A.md', 'missing_evidence')], undefined, 20, 12000);
  expect(board.groups[0]!.reviewState).not.toBe('completed');
  expect(board.groups[0]!.reviewState).not.toBe('resolved');
});

test('hidden evidence is not exposed in names, counts or fingerprints', async () => {
  await seed('A.md', '---\nllm_wiki_type: knowledge\nevidence_paths: [_scopes/users/other/Secret.md]\n---\nA conclusion.');
  await seed('_scopes/users/other/Secret.md', '# Classified\nPRIVATE_BODY');
  const signals = [await issue('A.md', 'missing_evidence')];
  const before = await review.group(signals, undefined, 20, 12000);
  await seed('_scopes/users/other/Secret.md', '# Other\nCHANGED_PRIVATE');
  const after = await review.group(signals, undefined, 20, 12000);
  expect(JSON.stringify(before)).not.toMatch(/Secret|PRIVATE_BODY|_scopes/);
  expect(after.groups[0]!.issueId).toBe(before.groups[0]!.issueId);
  expect(before.groups[0]!.dependenciesComplete).toBe(false);
});

test('stale owner candidates are not relabeled with fresh revisions', async () => {
  await seed('A.md', ordinary); const candidate = await issue('A.md', 'missing_evidence');
  await seed('A.md', ordinary + '\nA later user edit.');
  const board = await review.group([candidate], undefined, 20, 12000);
  expect(board.groups).toEqual([]);
});

test('small budgets retain exact guards or an explicit retry, never oversize JSON', async () => {
  await seed('A.md', ordinary); const candidate = await issue('A.md', 'missing_evidence');
  for (const maxChars of [512, 800, 1200, 4000]) {
    const board = await review.group([candidate], undefined, 20, maxChars);
    expect(JSON.stringify(board).length).toBeLessThanOrEqual(maxChars);
    if (board.groups?.length) expect(board.groups[0]!.nextAction.arguments.expectedRevision).toBe(candidate.revision);
    else expect(board.retry).toBeDefined();
  }
});

test('inaccessible and traversal candidates cause no source reads or public counts', async () => {
  await seed('A.md', ordinary);
  const candidate = await issue('A.md', 'missing_evidence');
  const read = vi.spyOn(fs, 'readNote');
  const board = await review.group(['../Secret.md', 'C:/Secret.md', '_scopes/users/other/Secret.md']
    .map(path => ({ ...candidate, path })), undefined, 20, 4000);
  expect(board.groups).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  expect(JSON.stringify(board)).not.toMatch(/Secret|_scopes/);
});

test('same-note diagnostics never forward arbitrary prose or mutation actions', async () => {
  await seed('A.md', ordinary);
  const candidate = await issue('A.md', 'missing_evidence');
  candidate.detail = '_scopes/users/other/Secret.md private instructions';
  candidate.nextAction = { endpointId: 'notes.delete', arguments: { path: 'Victim.md' } };
  const board = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0]!.nextAction.endpointId).toBe('notes.read');
  expect(JSON.stringify(board)).not.toMatch(/Secret|private instructions|notes.delete|Victim/);
});

test.each(['edit', 'hide', 'delete'])('owner %s during dependency reads drops the old finding', async mode => {
  await seed('A.md', ordinary);
  const candidate = await issue('A.md', 'missing_evidence');
  const original = fs.getBacklinks.bind(fs);
  let changed = false;
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (!changed) {
      changed = true;
      if (mode === 'delete') await rm(join(vault, 'A.md'));
      else await seed('A.md', mode === 'hide' ? '---\nmoderation_status: hidden\n---\nPrivate now.' : ordinary + '\nChanged now.');
    }
    return result;
  });
  const board = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups).toEqual([]);
  expect(JSON.stringify(board)).not.toMatch(/Private now|Changed now/);
});

test('scope access revoked during dependency IO removes the owner before output', async () => {
  const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await seed('_scopes/agents/worker/A.md', ordinary);
  const candidate = await issue('_scopes/agents/worker/A.md', 'missing_evidence');
  const original = fs.getBacklinks.bind(fs);
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    const result = await original(...args);
    principal.agentId = 'revoked';
    return result;
  });
  const board = await review.group([candidate], principal, 20, 4000);
  expect(board.groups).toEqual([]);
  expect(JSON.stringify(board)).not.toContain('worker/A.md');
});

test.each(['supports', 'claim_supports'])('incoming %s evidence revisions participate in the basis', async relation => {
  await seed('A.md', ordinary);
  const raw = relation === 'supports'
    ? '---\nllm_wiki_type: knowledge\nsupports: ["[[A]]"]\n---\nSupport one.'
    : '---\nllm_wiki_type: knowledge\nclaims:\n  - id: supporting\n    text: Support\n    supports_claims: ["[[A#^current]]"]\n---\nSupport one. ^supporting';
  await seed('Support.md', raw);
  const candidate = await issue('A.md', 'missing_evidence');
  const first = await review.group([candidate], undefined, 20, 12000);
  expect(first.groups[0]!.affectedEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Support.md' })]));
  await seed('Support.md', raw + '\nSupport changed.');
  const after = await review.group([candidate], undefined, 20, 12000);
  expect(after.groups[0]!.reviewBasis).not.toBe(first.groups[0]!.reviewBasis);
});

test('invalid JSON Canvas remains a recheck finding with a generated health action', async () => {
  await seed('Views/Broken.canvas', 'not JSON');
  const candidate: ExceptionBoardItem = { path: 'Views/Broken.canvas', code: 'canvas_invalid', category: 'validation',
    severity: 'error', state: 'open', sourceState: 'recheck_required', suggestedAction: 'ignore', detail: 'SECRET_PROSE',
    nextAction: { endpointId: 'notes.delete', arguments: { path: 'Victim.md' } } };
  const board: any = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0]).toMatchObject({ sourceState: 'recheck_required', reviewState: 'recheck_required',
    nextAction: { endpointId: 'wiki.canvas_health' } });
  expect(board.groups[0].revision).toBeUndefined();
  expect(JSON.stringify(board)).not.toMatch(/SECRET_PROSE|notes.delete|Victim|notes.read/);
  expect((await review.group([candidate], undefined, 20, 4000)).groups[0]!.issueId).toBe(board.groups[0].issueId);
});

test('managed Canvas uses current source revisions; unmanaged replacements disappear', async () => {
  await seed('A.md', ordinary);
  const revision = (await fs.readNote('A.md')).revision;
  const metadata = { kind: 'mcpvault-derived-canvas', version: 1, mode: 'neighborhood', rootNodeId: 'root',
    snapshotFingerprint: 'a'.repeat(64), revisions: { root: revision } };
  const canvas = { nodes: [{ id: 'root', type: 'file', file: 'A.md', x: 0, y: 0, width: 200, height: 100 },
    { id: 'meta', type: 'text', text: `<!-- mcpvault-canvas:${JSON.stringify(metadata)} -->`, x: 0, y: 200, width: 200, height: 100 }], edges: [] };
  await seed('Views/Map.canvas', JSON.stringify(canvas));
  const candidate: ExceptionBoardItem = { path: 'Views/Map.canvas', code: 'canvas_stale', category: 'freshness',
    revision: (await fs.readCanvasFile('Views/Map.canvas')).revision, severity: 'warning', state: 'open', sourceState: 'snapshot_matched',
    detail: 'UNTRUSTED', suggestedAction: 'ignore', nextAction: { endpointId: 'notes.read', arguments: {} } };
  const first: any = await review.group([candidate], undefined, 20, 12000);
  expect(first.groups).toHaveLength(1);
  expect(first.groups[0].revision).toBe(candidate.revision);
  expect(first.groups[0].nextAction.endpointId).toBe('wiki.canvas_health');
  expect(first.groups[0].affectedEvidence).toContainEqual({ path: 'A.md', revision });
  await seed('A.md', ordinary + '\nChanged source.');
  const second = await review.group([candidate], undefined, 20, 12000);
  expect(second.groups[0]!.issueId).not.toBe(first.groups[0].issueId);
  await seed('Views/Map.canvas', JSON.stringify({ nodes: [], edges: [] }));
  expect((await review.group([candidate], undefined, 20, 4000)).groups).toEqual([]);
});

test('controlled explanations and priority guidance do not copy candidate prose', async () => {
  await seed('A.md', ordinary);
  const candidate = await issue('A.md', 'missing_evidence'); candidate.detail = 'SECRET_PROSE';
  const board: any = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups[0].issues[0].explanation).toEqual(expect.any(String));
  expect(board.groups[0].reviewGuidance).toEqual(expect.any(String));
  expect(JSON.stringify(board)).not.toContain('SECRET_PROSE');
});

test('argument category does not outrank real integrity for broken evidence or contradictions', async () => {
  for (const path of ['A.md', 'B.md', 'Z.md']) await seed(path, ordinary);
  const board = await review.group([await issue('A.md', 'broken_evidence', 'argument_integrity'),
    await issue('B.md', 'unresolved_contradiction', 'argument_integrity'), await issue('Z.md', 'unsafe_path', 'validation')], undefined, 20, 12000);
  expect(board.groups.map(g => [g.path, g.priority])).toEqual([['Z.md', 'integrity'], ['A.md', 'evidence'], ['B.md', 'evidence']]);
});

test('visible owner storage failure signals retry rather than quiet empty output', async () => {
  await seed('A.md', ordinary); const candidate = await issue('A.md', 'missing_evidence');
  vi.spyOn(fs, 'readNote').mockRejectedValue(Object.assign(new Error('PRIVATE_HOST_PATH'), { code: 'EIO' }));
  const board = await review.group([candidate], undefined, 20, 512);
  expect(board).toMatchObject({ groups: [], truncated: true, retry: expect.any(Object) });
  expect(JSON.stringify(board)).not.toContain('PRIVATE_HOST_PATH');
});

test('source truncation propagates within the whole JSON budget even with no candidates', async () => {
  const group = review.group.bind(review) as (...args: any[]) => Promise<any>;
  const board = await group([], undefined, 20, 512, true);
  expect(board).toMatchObject({ groups: [], coverage: 'partial', truncated: true, retry: expect.any(Object) });
  expect(JSON.stringify(board).length).toBeLessThanOrEqual(512);
});

test('ambiguous alias lookup fails closed without preloading unrelated bodies', async () => {
  await seed('A.md', '---\nllm_wiki_type: knowledge\nevidence_paths: ["Alias"]\n---\nConclusion.');
  for (let i = 0; i < 12; i++) await seed(`Other${i}.md`, '---\naliases: [Alias]\n---\nUnrelated body.');
  const candidate = await issue('A.md', 'missing_evidence');
  const read = vi.spyOn(fs, 'readNote');
  const board = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups[0]!.dependenciesComplete).toBe(false);
  expect(read.mock.calls.filter(([path]) => /^Other/.test(path))).toHaveLength(0);
  expect(board.groups[0]!.reviewState).toBe('recheck_required');
});

test('new source read work is globally capped and exhaustion cannot certify completion', async () => {
  await seed('Source.md', ordinary);
  const candidates: ExceptionBoardItem[] = [];
  for (let i = 0; i < 24; i++) {
    const path = `Note${String(i).padStart(2, '0')}.md`;
    await seed(path, '---\nevidence_paths: [' + Array(32).fill('Source.md').join(', ') + ']\n---\nConclusion.');
    candidates.push(await issue(path, 'missing_evidence'));
  }
  const read = vi.spyOn(fs, 'readNote');
  const graph = vi.spyOn(fs, 'getBacklinks');
  const board = await review.group(candidates, undefined, 60, 12000);
  expect(read.mock.calls.length).toBeLessThanOrEqual(MAINTENANCE_REVIEW_LIMITS.reads);
  expect(graph.mock.calls.length).toBeLessThanOrEqual(MAINTENANCE_REVIEW_LIMITS.graphQueries);
  expect(board).toMatchObject({ coverage: 'partial', truncated: true, retry: expect.any(Object) });
  expect(JSON.stringify(board).length).toBeLessThanOrEqual(12000);
});

test('hidden Canvas source bodies do not enter output or fingerprints', async () => {
  const sourcePath = '_scopes/users/other/Secret.md';
  await seed(sourcePath, '# PRIVATE_BODY');
  const metadata = { kind: 'mcpvault-derived-canvas', version: 1, mode: 'neighborhood', rootNodeId: 'root',
    snapshotFingerprint: 'a'.repeat(64), revisions: { root: 'b'.repeat(64) } };
  await seed('Views/Map.canvas', JSON.stringify({ nodes: [{ id: 'root', type: 'file', file: sourcePath },
    { id: 'meta', type: 'text', text: `<!-- mcpvault-canvas:${JSON.stringify(metadata)} -->` }], edges: [] }));
  const candidate: ExceptionBoardItem = { path: 'Views/Map.canvas', code: 'canvas_scope_violation', category: 'validation',
    revision: (await fs.readCanvasFile('Views/Map.canvas')).revision, severity: 'error', state: 'open', sourceState: 'snapshot_matched',
    detail: sourcePath, suggestedAction: 'ignore', nextAction: { endpointId: 'notes.read', arguments: {} } };
  const read = vi.spyOn(fs, 'readNote');
  const before = await review.group([candidate], undefined, 20, 4000);
  await seed(sourcePath, '# CHANGED_PRIVATE');
  const after = await review.group([candidate], undefined, 20, 4000);
  expect(before.groups).toHaveLength(1);
  expect(before.groups[0]!.dependenciesComplete).toBe(false);
  expect(after.groups[0]!.issueId).toBe(before.groups[0]!.issueId);
  expect(JSON.stringify(after)).not.toMatch(/Secret|_scopes|PRIVATE/);
  expect(read).not.toHaveBeenCalled();
});

test('Canvas replaced during validation cannot retain a managed finding', async () => {
  await seed('Views/Broken.canvas', 'not JSON');
  const candidate: ExceptionBoardItem = { path: 'Views/Broken.canvas', code: 'canvas_invalid', category: 'validation',
    severity: 'error', state: 'open', sourceState: 'recheck_required', suggestedAction: 'inspect', detail: 'Invalid',
    nextAction: { endpointId: 'wiki.canvas_health', arguments: {} } };
  const original = fs.readCanvasFile.bind(fs);
  let calls = 0;
  vi.spyOn(fs, 'readCanvasFile').mockImplementation(async (...args) => {
    if (++calls === 2) await seed('Views/Broken.canvas', '{"nodes":[],"edges":[]}');
    return original(...args);
  });
  const board = await review.group([candidate], undefined, 20, 4000);
  expect(board.groups).toEqual([]);
  expect(board.truncated).toBe(true);
});

test('Canvas responses preserve exact known identity or retry across small budgets', async () => {
  await seed('Views/Broken.canvas', 'not JSON');
  const candidate: ExceptionBoardItem = { path: 'Views/Broken.canvas', code: 'canvas_invalid', category: 'validation',
    severity: 'error', state: 'open', sourceState: 'recheck_required', suggestedAction: 'inspect', detail: 'Invalid',
    nextAction: { endpointId: 'wiki.canvas_health', arguments: {} } };
  for (const maxChars of [512, 800, 1200, 4000]) {
    const board = await review.group([candidate], undefined, 20, maxChars, true);
    expect(JSON.stringify(board).length).toBeLessThanOrEqual(maxChars);
    if (board.groups.length) expect(board.groups[0]!.nextAction.endpointId).toBe('wiki.canvas_health');
    else expect(board.retry).toBeDefined();
  }
});
