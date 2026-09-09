import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { StoryService } from './story-service.js';
import { FrontmatterHandler } from './frontmatter.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('story-visual-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'story-visual-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), auth = new ScopeAuthService(root);
  const refs = new ReferenceService(fs, access), actors: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'writer', 'outsider']) actors[id] = (await auth.register({ accountId: id, modelId: id, password: 'disposable-visual-test-password' })).principal;
  const tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  const service = new StoryService(fs, access, refs, auth, work, tasks);
  const run = (endpoint: string, params: Record<string, any>, actor = actors.writer!) => service.execute(endpoint, { projectId: 'novel', ...params }, actor);
  const project = await run('project', { op: 'create', title: 'Library', brief: { medium: 'novel' }, participants: ['writer'], expectedRevision: 'missing', requestId: 'project' }, actors.owner);
  let counter = 0;
  const put = (artifactId: string, kind: string, content: string, extra: Record<string, any> = {}) => run('artifact', {
    op: 'create', artifactId, kind, title: artifactId, content, expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: `put-${++counter}`, ...extra,
  });
  await put('iris', 'character', 'Iris'); await put('moss', 'character', 'Moss');
  await put('hall', 'place', 'Hall'); await put('garden', 'place', 'Garden');
  const scene = await put('opening', 'scene', 'Prelude. Iris enters the hall. Moss waves. Epilogue.');
  const source = await run('artifact', { artifactId: 'opening' });
  const event = (id: string, quote: string, actorId: string, action: string) => {
    const start = Array.from(source.content.slice(0, source.content.indexOf(quote))).length;
    return { id, actorId, action, locationId: 'hall', basis: 'stated', passage: { start, end: start + Array.from(quote).length, quote } };
  };
  const data = { sourceSceneId: 'opening', sourceSceneRevision: scene.revision, visual: { events: [
    event('arrival', 'Iris enters the hall.', 'iris', 'enters'), event('wave', 'Moss waves.', 'moss', 'waves'),
  ] } };
  const model = await put('opening-map', 'visual_model', 'Explicit annotations, not a complete interpretation.', { data });
  const intent = { type: 'move_entity', eventIds: ['arrival'], actorId: 'iris', locationId: 'garden' };
  const preview = () => run('visual', { op: 'preview', modelId: 'opening-map', sourceRevision: model.revision, intent, maxChars: 12000 });
  const proposal = (fingerprint: string) => ({ op: 'propose', modelId: 'opening-map', sourceRevision: model.revision, intent, fingerprint,
    replacements: [{ eventId: 'arrival', content: 'Iris enters the garden.' }], artifactId: 'garden-alternative', title: 'Garden version',
    expectedRevision: 'missing', expectedProjectRevision: project.revision, requestId: 'propose-garden' });
  return { root, fs, access, auth, refs, tasks, work, service, actors, run, put, project, scene, source, data, model, intent, preview, proposal };
}

test('visual annotations resolve character and place pins, expose three source-linked projections and remain partial', async () => {
  const f = await fixture();
  const model = await f.run('artifact', { artifactId: 'opening-map', maxChars: 12000 });
  expect(model.sources.map((s: any) => s.path)).toEqual(expect.arrayContaining([f.scene.path, 'Community/Stories/novel/Artifacts/iris.md', 'Community/Stories/novel/Artifacts/hall.md']));
  for (const view of ['timeline', 'interactions', 'locations']) {
    const read = await f.run('visual', { modelId: 'opening-map', view, maxChars: 12000 });
    expect(read).toMatchObject({ view, advisory: true, coverage: 'partial', sourceSceneId: 'opening', sourceSceneRevision: f.scene.revision });
    expect(read.items.map((item: any) => item.eventId)).toEqual(['arrival', 'wave']);
    expect(read.items[0].passage.quote).toBe('Iris enters the hall.');
    if (view === 'timeline') expect(read.items[0].presentationIndex).toBe(0);
    if (view === 'interactions') expect(read.items[0].edge).toEqual({ from: 'iris', to: null, label: 'enters', targetSpecified: false });
    if (view === 'locations') expect(read.items[0].placement).toEqual({ entityId: 'iris', placeId: 'hall', known: true });
  }
});

test('preview is read-only and a bounded proposal is an alternative with reviewable provenance, not a scene replacement', async () => {
  const f = await fixture(), before = await f.run('artifact', { op: 'list', maxChars: 12000 });
  const preview = await f.preview();
  expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(preview.items[0]).toMatchObject({ eventId: 'arrival', before: { locationId: 'hall' }, after: { locationId: 'garden' } });
  expect((await f.run('artifact', { op: 'list', maxChars: 12000 })).total).toBe(before.total);
  const candidate = await f.run('visual', f.proposal(preview.fingerprint));
  expect(candidate.kind).toBe('alternative');
  const read = await f.run('artifact', { artifactId: 'garden-alternative', maxChars: 12000 });
  expect(read.content).toBe(f.source.content.replace('Iris enters the hall.', 'Iris enters the garden.'));
  expect(read.data.visualProposal).toMatchObject({ modelId: 'opening-map', modelRevision: f.model.revision, intent: f.intent, fingerprint: preview.fingerprint });
  expect((await f.run('artifact', { artifactId: 'opening' })).revision).toBe(f.scene.revision);
  expect((await f.run('project', {})).revision).toBe(f.project.revision);
  expect(await f.run('visual', f.proposal(preview.fingerprint))).toMatchObject({ revision: candidate.revision, replayed: true });
});

test('reordering creates a prose alternative and does not rewrite explicit story chronology', async () => {
  const f = await fixture(), intent = { type: 'reorder_events', eventIds: ['wave', 'arrival'] };
  const preview = await f.run('visual', { op: 'preview', modelId: 'opening-map', sourceRevision: f.model.revision, intent, maxChars: 12000 });
  const request = { ...f.proposal(preview.fingerprint), intent }; delete (request as any).replacements;
  const result = await f.run('visual', request);
  const note = await f.run('artifact', { artifactId: 'garden-alternative', maxChars: 12000 });
  expect(note.content).toBe(f.source.content.replace('Iris enters the hall. Moss waves.', 'Moss waves. Iris enters the hall.'));
  expect(result.kind).toBe('alternative');
  expect((await f.run('project', {})).revision).toBe(f.project.revision);
});

test('visual previews and proposals reject source drift and wrong preview fingerprints without creating targets', async () => {
  const f = await fixture(), preview = await f.preview();
  await expect(f.run('visual', f.proposal('0'.repeat(64)))).rejects.toThrow(/fingerprint/i);
  await f.put('opening', 'scene', 'Changed source.', { op: 'update', expectedRevision: f.scene.revision });
  await expect(f.preview()).rejects.toThrow(/stale|revision/i);
  await expect(f.run('visual', f.proposal(preview.fingerprint))).rejects.toThrow(/stale|revision/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/garden-alternative.md')).toBe(false);
  expect(await f.run('artifact', { artifactId: 'opening-map' })).toMatchObject({ stale: true });
});

test('model writes reject wrong passage, entity kind, missing entity, foreign branch and fenced examples', async () => {
  const f = await fixture();
  const bad = (visual: any) => f.put('bad-map', 'visual_model', '', { data: { ...f.data, visual } });
  for (const changes of [{ actorId: 'garden' }, { actorId: 'missing' }, { passage: { start: 0, end: 5, quote: 'wrong' } }]) {
    await expect(bad({ events: [{ ...f.data.visual.events[0], ...changes }] })).rejects.toThrow();
  }
  await f.put('remote', 'character', 'Other branch', { branchId: 'alternate' });
  await expect(bad({ events: [{ ...f.data.visual.events[0], actorId: 'remote' }] })).rejects.toThrow(/branch/i);
  const fenced = await f.put('example', 'scene', '~~~md\nIris enters the hall.\n~~~');
  await expect(f.put('fenced-map', 'visual_model', '', { data: { sourceSceneId: 'example', sourceSceneRevision: fenced.revision,
    visual: { events: [{ ...f.data.visual.events[0], passage: { start: 6, end: 27, quote: 'Iris enters the hall.' } }] } } })).rejects.toThrow();
});

test('proposal writes require current membership, project revision and writable host; public reads do not grant mutation', async () => {
  const f = await fixture(), preview = await f.preview();
  await expect(f.service.execute('visual', { projectId: 'novel', ...f.proposal(preview.fingerprint) })).rejects.toThrow(/auth/i);
  await expect(f.run('visual', f.proposal(preview.fingerprint), f.actors.outsider)).rejects.toThrow(/member|participant/i);
  const ro = new StoryService(f.fs, f.access, f.refs, f.auth, f.work, f.tasks, { readOnly: true });
  await expect(ro.execute('visual', { projectId: 'novel', ...f.proposal(preview.fingerprint) }, f.actors.writer)).rejects.toThrow(/read.only/i);
  const changed = await f.run('project', { op: 'update', enabled: false, expectedRevision: f.project.revision, requestId: 'disable' }, f.actors.owner);
  expect(changed.revision).not.toBe(f.project.revision);
  await expect(f.run('visual', f.proposal(preview.fingerprint))).rejects.toThrow(/disabled|revision/i);
});

test('visual continuation is bounded and bound to view, selection and actor', async () => {
  const f = await fixture();
  const read = await f.run('visual', { modelId: 'opening-map', limit: 1, maxChars: 2000 });
  expect(read.truncated).toBe(true); expect(JSON.stringify(read).length).toBeLessThanOrEqual(2000);
  const next = await f.run('visual', { modelId: 'opening-map', limit: 1, maxChars: 2000, cursor: read.cursor });
  expect(next.items[0].eventId).toBe('wave');
  for (const extra of [{ view: 'locations' }, { eventIds: ['wave'] }]) {
    await expect(f.run('visual', { modelId: 'opening-map', cursor: read.cursor, ...extra })).rejects.toThrow(/cursor/i);
  }
  await expect(f.run('visual', { modelId: 'opening-map', cursor: read.cursor }, f.actors.owner)).rejects.toThrow(/cursor/i);
});

test('direct artifact writes cannot forge visual proposal provenance or enlarge the selected patch', async () => {
  const f = await fixture(), preview = await f.preview();
  await f.run('visual', f.proposal(preview.fingerprint));
  const candidate = await f.run('artifact', { artifactId: 'garden-alternative', maxChars: 12000 });
  await expect(f.put('forged', 'alternative', `${candidate.content}Changed unrelated paragraph.`, { data: candidate.data })).rejects.toThrow(/proposal|content|patch/i);
  await expect(f.put('forged-kind', 'scene', candidate.content, { data: candidate.data })).rejects.toThrow(/alternative|kind/i);
  await expect(f.put('forged-header', 'alternative', `---\nunrelated: changed\n---\n${candidate.content}`, { data: candidate.data })).rejects.toThrow(/proposal|content|patch/i);
});

test('review and adoption of a visual alternative do not make it stale from their own project bookkeeping', async () => {
  const f = await fixture(), preview = await f.preview(), candidate = await f.run('visual', f.proposal(preview.fingerprint));
  await f.run('review', { op: 'create', reviewId: 'visual-review', artifactId: 'garden-alternative', sourceRevision: candidate.revision,
    content: 'Check the new location; prose is still an alternative.', expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'review-candidate' });
  const adopted = await f.run('adopt', { artifactId: 'garden-alternative', sourceRevision: candidate.revision, reviewIds: ['visual-review'], reason: 'Preserve this alternative',
    expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'adopt-alternative' }, f.actors.owner);
  expect(adopted.adopted).toBe(true);
  expect(await f.run('artifact', { artifactId: 'garden-alternative' })).toMatchObject({ stale: false });
  expect(await f.run('sequence', {})).toMatchObject({ presentation: [], chronology: [] });
});

test('visual reads honor explicit sourceRevision and reject unsupported field continuation', async () => {
  const f = await fixture();
  await expect(f.run('visual', { modelId: 'opening-map', sourceRevision: '0'.repeat(64) })).rejects.toThrow(/revision/i);
  await expect(f.run('visual', { modelId: 'opening-map', field: 'secret' })).rejects.toThrow(/field/i);
});

test('destination revision changes invalidate a preview, and unavailable references do not leak their title', async () => {
  const f = await fixture(), preview = await f.preview(), garden = await f.run('artifact', { artifactId: 'garden' });
  await f.put('garden', 'place', 'Changed garden', { op: 'update', expectedRevision: garden.revision });
  await expect(f.run('visual', f.proposal(preview.fingerprint))).rejects.toThrow(/fingerprint/i);
  const original = f.access.canAccessPhysicalPath.bind(f.access);
  vi.spyOn(f.access, 'canAccessPhysicalPath').mockImplementation((path, actor) => !path.endsWith('/iris.md') && original(path, actor));
  await expect(f.run('visual', { modelId: 'opening-map' })).rejects.toThrow(/unavailable|scope/i);
});

test('a source change at the final guarded write rejects the whole alternative', async () => {
  const f = await fixture(), preview = await f.preview();
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  let injected = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (args[0].path.endsWith('/garden-alternative.md') && !injected) {
      injected = true;
      const path = join(f.root, f.scene.path);
      await writeFile(path, `${await readFile(path, 'utf8')}External scene edit.\n`);
    }
    return original(...args);
  });
  await expect(f.run('visual', f.proposal(preview.fingerprint))).rejects.toThrow(/revision|changed|conflict/i);
  expect(injected).toBe(true);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/garden-alternative.md')).toBe(false);
});

test('concurrent proposals to the same alternative ID have one winner and preserve the source', async () => {
  const f = await fixture(), preview = await f.preview();
  const results = await Promise.allSettled(['first-proposal', 'second-proposal'].map(requestId =>
    f.run('visual', { ...f.proposal(preview.fingerprint), requestId })));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await f.run('artifact', { artifactId: 'opening' })).revision).toBe(f.scene.revision);
});

test('host-edited visual models cannot hide duplicate declared pins behind the old dependency manifest', async () => {
  const f = await fixture(), note = await f.fs.readNote(f.model.path);
  const fm = { ...note.frontmatter, artifact_sources: [...note.frontmatter.artifact_sources, note.frontmatter.artifact_sources[0]] };
  await writeFile(join(f.root, f.model.path), new FrontmatterHandler().stringify(fm, note.content));
  await expect(f.run('visual', { modelId: 'opening-map' })).rejects.toThrow(/duplicate|source/i);
});

test('persisted visual models require every reconstructed source guard to remain recorded', async () => {
  const f = await fixture(), note = await f.fs.readNote(f.model.path);
  const fm = { ...note.frontmatter, source_revisions: note.frontmatter.source_revisions.filter((guard: any) => guard.path !== f.scene.path) };
  expect(fm.source_revisions.length).toBeLessThan(note.frontmatter.source_revisions.length);
  await writeFile(join(f.root, f.model.path), new FrontmatterHandler().stringify(fm, note.content));
  const changed = await f.fs.readNote(f.model.path);
  await expect(f.run('visual', { modelId: 'opening-map' })).rejects.toThrow(/missing|recorded|pin/i);
  await expect(f.run('review', { op: 'create', reviewId: 'missing-pin-review', artifactId: 'opening-map', sourceRevision: changed.revision,
    content: 'Missing pinned manifest.', expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'missing-pin-review' }, f.actors.owner)).rejects.toThrow(/missing|recorded|pin/i);
  await expect(f.run('adopt', { artifactId: 'opening-map', sourceRevision: changed.revision, reason: 'Missing pinned manifest',
    expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'missing-pin-adopt' }, f.actors.owner)).rejects.toThrow(/missing|recorded|pin/i);
});

test('review and adoption revalidate a host-edited alternative body instead of trusting its new revision', async () => {
  const f = await fixture(), preview = await f.preview(), candidate = await f.run('visual', f.proposal(preview.fingerprint));
  const path = join(f.root, candidate.path);
  await writeFile(path, `${await readFile(path, 'utf8')}Outside-selection forgery.\n`);
  const changed = await f.fs.readNote(candidate.path);
  await expect(f.run('review', { op: 'create', reviewId: 'forged-review', artifactId: 'garden-alternative', sourceRevision: changed.revision,
    content: 'This must not certify a forged patch.', expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'forged-review' }, f.actors.owner)).rejects.toThrow(/proposal|patch|content/i);
  await expect(f.run('adopt', { artifactId: 'garden-alternative', sourceRevision: changed.revision, reason: 'Not valid',
    expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'forged-adopt' }, f.actors.owner)).rejects.toThrow(/proposal|patch|content/i);
});

test('editorial consumption rejects host-edited model locators and changed proposal intent', async () => {
  const f = await fixture(), preview = await f.preview(), candidate = await f.run('visual', f.proposal(preview.fingerprint));
  const model = await f.fs.readNote(f.model.path), modelFm = structuredClone(model.frontmatter);
  modelFm.data.visual.events[0].passage.quote = 'Wrong quote';
  await writeFile(join(f.root, f.model.path), new FrontmatterHandler().stringify(modelFm, model.content));
  const modelChanged = await f.fs.readNote(f.model.path);
  await expect(f.run('adopt', { artifactId: 'opening-map', sourceRevision: modelChanged.revision, reason: 'Bad locator',
    expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'bad-map-adopt' }, f.actors.owner)).rejects.toThrow(/passage|visual/i);
  // Restore only the disposable fixture's model before testing an independent
  // metadata forgery on the alternative.
  await writeFile(join(f.root, f.model.path), model.originalContent);
  const alternative = await f.fs.readNote(candidate.path), fm = structuredClone(alternative.frontmatter);
  fm.data.visualProposal.intent = { type: 'set_action', eventIds: ['arrival'], action: 'runs' };
  await writeFile(join(f.root, candidate.path), new FrontmatterHandler().stringify(fm, alternative.content));
  const changed = await f.fs.readNote(candidate.path);
  await expect(f.run('adopt', { artifactId: 'garden-alternative', sourceRevision: changed.revision, reason: 'Changed intent',
    expectedRevision: 'missing', expectedProjectRevision: f.project.revision, requestId: 'bad-intent-adopt' }, f.actors.owner)).rejects.toThrow(/fingerprint|intent|proposal/i);
});
