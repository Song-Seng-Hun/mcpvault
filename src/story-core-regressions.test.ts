import { afterEach, expect, test, vi } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { FrontmatterHandler } from './frontmatter.js';
import { StoryService } from './story-service.js';
import { storyHash, type StoryParams } from './story-model.js';

vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'story-core-regressions-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), auth = new ScopeAuthService(root);
  const refs = new ReferenceService(fs, access), actors: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'writer']) actors[id] = (await auth.register({ accountId: id, modelId: id, password: 'fixture-password-only' })).principal;
  const tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  const service = new StoryService(fs, access, refs, auth, work, tasks);
  let counter = 0;
  const execute = (endpoint: string, params: StoryParams, actor = actors.owner!) => service.execute(endpoint, params, actor);
  const project = (projectId = 'novel') => execute('project', { op: 'create', projectId, title: projectId,
    brief: { medium: 'novel' }, participants: ['writer'], expectedRevision: 'missing', requestId: `project-${projectId}` });
  const current = (projectId = 'novel') => execute('project', { projectId });
  const put = async (artifactId: string, extra: StoryParams = {}) => execute('artifact', {
    op: 'create', projectId: 'novel', artifactId, kind: 'scene', title: artifactId, content: `${artifactId} body`,
    expectedRevision: 'missing', expectedProjectRevision: (await current(extra.projectId ?? 'novel')).revision,
    requestId: `artifact-${++counter}`, ...extra,
  });
  const reviewParams = async (artifact: StoryParams, extra: StoryParams = {}) => ({ op: 'create', projectId: 'novel',
    reviewId: 'review', artifactId: artifact.artifactId, sourceRevision: artifact.revision, content: 'Original editorial judgment.',
    expectedRevision: 'missing', expectedProjectRevision: (await current()).revision, requestId: `review-${++counter}`, ...extra });
  const adoptParams = async (artifact: StoryParams, extra: StoryParams = {}) => ({ projectId: 'novel', artifactId: artifact.artifactId,
    sourceRevision: artifact.revision, reason: 'Select this exact draft.', expectedRevision: 'missing',
    expectedProjectRevision: (await current()).revision, requestId: `adopt-${++counter}`, ...extra });
  const edit = async (path: string, fields: StoryParams) => {
    const note = await fs.readNote(path);
    await writeFile(join(root, path), new FrontmatterHandler().stringify({ ...note.frontmatter, ...fields }, note.content));
    return { ...(await fs.readNote(path)), path };
  };
  await project();
  return { root, fs, refs, actors, service, execute, project, current, put, reviewParams, adoptParams, edit };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function chain(f: Fixture) {
  const fact = await f.put('fact', { kind: 'bible' });
  const summary = await f.put('summary', { kind: 'summary', sources: [{ artifactId: 'fact', revision: fact.revision }] });
  const scene = await f.put('scene', { sources: [{ artifactId: 'summary', revision: summary.revision }] });
  return { fact, summary, scene };
}

async function forbiddenTarget(f: Fixture, boundary: string) {
  if (boundary === 'private') {
    const path = '_scopes/models/owner/private.md';
    await f.fs.writeNote({ path, content: 'PRIVATE-CANARY' });
    return { path, revision: (await f.fs.readNote(path)).revision! };
  }
  if (boundary === 'project') await f.project('other');
  return f.put('foreign', boundary === 'project' ? { projectId: 'other' } : { branchId: 'alternate' });
}

test('review creation cannot overwrite another participant review and original retries still work', async () => {
  const f = await fixture(), scene = await f.put('scene'), request = await f.reviewParams(scene);
  const review = await f.execute('review', request);
  await expect(f.execute('review', { ...request, requestId: 'replacement', expectedRevision: review.revision,
    content: 'Replacement judgment.' }, f.actors.writer)).rejects.toThrow(/immutable|exists|missing/i);
  const saved = await f.fs.readNote(review.path);
  expect(saved.revision).toBe(review.revision);
  expect(saved.frontmatter.reviewer_account_id).toBe('owner');
  expect(saved.content).toContain('Original editorial judgment.');
  expect(await f.execute('review', request)).toMatchObject({ revision: review.revision, replayed: true });
});

test('shot metadata cannot contradict its explicit scene source pin', async () => {
  const f = await fixture(), scene = await f.put('scene');
  await expect(f.put('shot', { kind: 'shot', data: { sourceSceneId: 'scene', sourceSceneRevision: '0'.repeat(64) },
    sources: [{ artifactId: 'scene', revision: scene.revision }] })).rejects.toThrow(/scene.*revision|source.*revision|conflict/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/shot.md')).toBe(false);
});

test('matching and automatically inserted shot scene pins remain valid', async () => {
  const f = await fixture(), scene = await f.put('scene');
  for (const explicit of [false, true]) {
    const shot = await f.put(`shot-${explicit}`, { kind: 'shot', data: { sourceSceneId: 'scene', sourceSceneRevision: scene.revision },
      ...(explicit && { sources: [{ artifactId: 'scene', revision: scene.revision }] }) });
    const saved = await f.fs.readNote(shot.path);
    expect(saved.frontmatter.source_revisions).toEqual([{ path: scene.path, expectedRevision: scene.revision }]);
  }
});

test('a reference reread cannot replace the explicit pin after an external source edit', async () => {
  const f = await fixture(), source = await f.put('source');
  const original = f.service.workspace.referencesFor.bind(f.service.workspace);
  vi.spyOn(f.service.workspace, 'referencesFor').mockImplementationOnce(async (...args) => {
    await appendFile(join(f.root, source.path), '\nExternal source edit.\n');
    return original(...args);
  });
  await expect(f.put('derived', { sources: [{ artifactId: 'source', revision: source.revision }],
    content: `Uses [[${source.path}]].` })).rejects.toThrow(/conflict|revision|stale/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/derived.md')).toBe(false);
});

test('matching reference and explicit source pins are deduplicated without changing their revision', async () => {
  const f = await fixture(), source = await f.put('source');
  const derived = await f.put('derived', { sources: [{ artifactId: 'source', revision: source.revision }], content: `Uses [[${source.path}]].` });
  expect((await f.fs.readNote(derived.path)).frontmatter.source_revisions).toEqual([{ path: source.path, expectedRevision: source.revision }]);
});

test('reviews and selected snapshots retain the complete exact transitive source manifest', async () => {
  const f = await fixture(), { fact, summary, scene } = await chain(f);
  const review = await f.execute('review', await f.reviewParams(scene));
  const adopted = await f.execute('adopt', await f.adoptParams(scene, { reviewIds: ['review'] }));
  for (const path of [review.path, adopted.path]) {
    const pins = (await f.fs.readNote(path)).frontmatter.source_revisions;
    expect(pins).toEqual(expect.arrayContaining([fact, summary, scene].map(n => ({ path: n.path, expectedRevision: n.revision }))));
    expect(new Set(pins.map((pin: StoryParams) => pin.path)).size).toBe(pins.length);
  }
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted.main.scene.revision).toBe(adopted.revision);
});

test.each(['review', 'snapshot', 'activation'])('indirect source changes before %s cannot commit stale editorial state', async phase => {
  const f = await fixture(), { fact, scene } = await chain(f);
  const request = phase === 'review' ? await f.reviewParams(scene) : await f.adoptParams(scene, { requestId: 'race-adopt' });
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  let changed = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
    const target = phase === 'review' ? params.path.includes('/Reviews/') : phase === 'snapshot' ? params.path.includes('/Adoptions/') : params.path.endsWith('/Project.md');
    if (target && !changed) { changed = true; await appendFile(join(f.root, fact.path), '\nChanged just before commit.\n'); }
    return original(params, guards, policy);
  });
  await expect(f.execute(phase === 'review' ? 'review' : 'adopt', request)).rejects.toThrow(/revision|stale|changed/i);
  expect((await f.fs.readNote(fact.path)).revision).not.toBe(fact.revision);
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
  if (phase === 'review') expect(await f.fs.noteExists('Community/Stories/novel/Reviews/review.md')).toBe(false);
  if (phase === 'activation') {
    const snapshotPath = `Community/Stories/novel/Adoptions/adopt-${storyHash({ actor: 'owner', requestId: 'race-adopt' }).slice(0, 32)}.md`;
    const prepared = await f.fs.readNote(snapshotPath);
    await expect(f.execute('adopt', request)).rejects.toThrow(/revision|stale|changed/i);
    expect((await f.fs.readNote(snapshotPath)).revision).toBe(prepared.revision);
  }
});

test.each(['private', 'project', 'branch'].flatMap(boundary => ['source_revisions', 'references'].flatMap(field =>
  ['review', 'adopt'].map(operation => ({ boundary, field, operation }))))
)('rejects a manually edited $field crossing $boundary during $operation', async ({ boundary, field, operation }) => {
  const f = await fixture(), target = await forbiddenTarget(f, boundary), summary = await f.put('summary', { kind: 'summary' });
  const changed = await f.edit(summary.path, { [field]: field === 'references' ? [target.path] : [{ path: target.path, expectedRevision: target.revision }] });
  const scene = await f.put('scene', { sources: [{ artifactId: 'summary', revision: changed.revision }] });
  const request = operation === 'review' ? await f.reviewParams(scene) : await f.adoptParams(scene);
  await expect(f.execute(operation, request)).rejects.toThrow(/scope|private|branch|project|reference|source|stale|unavailable/i);
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
});

test('oversized edited dependency manifests fail closed instead of dropping duplicate entries', async () => {
  const f = await fixture(), source = await f.put('source'), summary = await f.put('summary', { kind: 'summary' });
  const changed = await f.edit(summary.path, { source_revisions: Array.from({ length: 129 }, () => ({ path: source.path, expectedRevision: source.revision })) });
  const scene = await f.put('scene', { sources: [{ artifactId: 'summary', revision: changed.revision }] });
  await expect(f.execute('adopt', await f.adoptParams(scene))).rejects.toThrow(/bound|budget|limit|128|source|stale/i);
});

function graphWithText(location: string, text: string) {
  const graph = { revision: 'graph', startNodeId: 'start', variables: [{ id: 'mood', type: 'string', initialValue: 'clear' }],
    nodes: [{ id: 'start', choices: [{ id: 'go', label: 'Continue', targetId: 'end',
      conditions: [{ variableId: 'mood', operator: 'ne', value: 'blocked' }], effects: [{ variableId: 'mood', operation: 'set', value: 'done' }] }] },
    { id: 'end', end: true, choices: [] }] };
  const choice = graph.nodes[0]!.choices[0]!;
  if (location === 'label') choice.label = text;
  else if (location === 'initial') graph.variables[0]!.initialValue = text;
  else if (location === 'condition') choice.conditions[0]!.value = text;
  else choice.effects[0]!.value = text;
  return graph;
}

test.each(['private', 'project', 'branch'].flatMap(boundary => ['label', 'initial', 'condition', 'effect'].map(location => ({ boundary, location }))))(
  'nested graph $location cannot smuggle a $boundary reference', async ({ boundary, location }) => {
    const f = await fixture(), target = await forbiddenTarget(f, boundary);
    await expect(f.put('graph', { kind: 'branch_graph', data: { graph: graphWithText(location, `[[${target.path}]]`) } }))
      .rejects.toThrow(/scope|private|branch|project|reference|unavailable/i);
    expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/graph.md')).toBe(false);
  });

test('safe nested graph references are persisted and later source changes mark the graph stale', async () => {
  const f = await fixture(), source = await f.put('source');
  const graph = await f.put('graph', { kind: 'branch_graph', data: { graph: graphWithText('label', `[[${source.path}|Continue]]`) } });
  expect((await f.fs.readNote(graph.path)).frontmatter.source_revisions).toContainEqual({ path: source.path, expectedRevision: source.revision });
  await appendFile(join(f.root, source.path), '\nChanged source.\n');
  expect(await f.execute('artifact', { projectId: 'novel', artifactId: 'graph' })).toMatchObject({ stale: true });
});

test('artifact title cannot smuggle a private reference', async () => {
  const f = await fixture(), target = await forbiddenTarget(f, 'private');
  await expect(f.put('private-title', { title: `Uses [[${target.path}]].` })).rejects.toThrow(/scope|private|reference|unavailable/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/private-title.md')).toBe(false);
});

test('artifact titles cannot inject Markdown lines or fences', async () => {
  const f = await fixture();
  for (const title of ['Heading\n~~~', 'Heading\r~~~']) {
    await expect(f.put('multiline-title', { title })).rejects.toThrow(/title|single.line|newline/i);
    expect(await f.fs.noteExists('Community/Stories/novel/Artifacts/multiline-title.md')).toBe(false);
  }
});

test.each(['private', 'project', 'branch'])('adoption reason rejects a $boundary wikilink before preparing any snapshot', async boundary => {
  const f = await fixture(), target = await forbiddenTarget(f, boundary), scene = await f.put('scene');
  await expect(f.execute('adopt', await f.adoptParams(scene, { reason: `Adopt because [[${target.path}]].` })))
    .rejects.toThrow(/scope|private|branch|project|reference|unavailable/i);
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
});

test('a valid adoption reason reference and its dependencies are pinned in the selected snapshot', async () => {
  const f = await fixture(), { fact, summary } = await chain(f), scene = await f.put('standalone');
  const adopted = await f.execute('adopt', await f.adoptParams(scene, { reason: `Select using [[${summary.path}]].` }));
  expect((await f.fs.readNote(adopted.path)).frontmatter.source_revisions).toEqual(expect.arrayContaining([
    { path: summary.path, expectedRevision: summary.revision }, { path: fact.path, expectedRevision: fact.revision },
  ]));
});

test('an adoption reason dependency changed before activation cannot select its prepared snapshot', async () => {
  const f = await fixture(), { fact, summary } = await chain(f), scene = await f.put('standalone');
  const request = await f.adoptParams(scene, { reason: `Select using [[${summary.path}]].` });
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
    if (params.path.endsWith('/Project.md')) await appendFile(join(f.root, fact.path), '\nReason source changed.\n');
    return original(params, guards, policy);
  });
  await expect(f.execute('adopt', request)).rejects.toThrow(/revision|stale|changed/i);
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
});

test.each([false, true])('prepared adoption retries retain original reason pins (changed=%s)', async changed => {
  const f = await fixture(), reasonSource = await f.put('reason-source'), scene = await f.put('scene');
  const request = await f.adoptParams(scene, { reason: `Select using [[${reasonSource.path}]].`, requestId: 'prepared-retry' });
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  const write = vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
    if (params.path.endsWith('/Project.md')) throw new Error('Injected activation interruption');
    return original(params, guards, policy);
  });
  await expect(f.execute('adopt', request)).rejects.toThrow('Injected activation interruption');
  write.mockRestore();
  const snapshotPath = `Community/Stories/novel/Adoptions/adopt-${storyHash({ actor: 'owner', requestId: 'prepared-retry' }).slice(0, 32)}.md`;
  const prepared = await f.fs.readNote(snapshotPath);
  if (changed) {
    await appendFile(join(f.root, reasonSource.path), '\nReason edited after preparation.\n');
    await expect(f.execute('adopt', request)).rejects.toThrow(/revision|stale|changed/i);
    expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
  } else {
    expect(await f.execute('adopt', request)).toMatchObject({ adopted: true, revision: prepared.revision, replayed: true });
  }
  expect((await f.fs.readNote(snapshotPath)).revision).toBe(prepared.revision);
});

test.each(['private', 'project', 'branch'].flatMap(boundary => ['body', 'graph'].flatMap(field =>
  ['review', 'adopt'].map(operation => ({ boundary, field, operation }))))
)('host-authored $field cannot cross $boundary in $operation with empty stored references', async ({ boundary, field, operation }) => {
  const f = await fixture(), target = await forbiddenTarget(f, boundary), scene = await f.put('scene');
  const original = await f.fs.readNote(scene.path), link = `[[${target.path}]]`;
  const fm = { ...original.frontmatter, references: [], source_revisions: [], ...(field === 'graph' && { data: { graph: graphWithText('label', link) } }) };
  await writeFile(join(f.root, scene.path), new FrontmatterHandler().stringify(fm, field === 'body' ? link : original.content));
  const changed = { ...scene, revision: (await f.fs.readNote(scene.path)).revision };
  await expect(f.execute(operation, operation === 'review' ? await f.reviewParams(changed) : await f.adoptParams(changed)))
    .rejects.toThrow(/scope|private|branch|project|reference|unavailable/i);
  expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
});

test.each(['title', 'findings', 'reason', 'brief'])('host-authored $field is checked independently of other field fences', async field => {
  const f = await fixture(), target = await forbiddenTarget(f, 'private'), scene = await f.put('scene');
  const link = `[[${target.path}]]`;
  const changed = await f.edit(scene.path, { data: { purpose: '~~~' }, [field]: field === 'findings' ? [{ text: link }] : field === 'brief' ? { theme: link } : link });
  await expect(f.execute('adopt', await f.adoptParams({ ...scene, revision: changed.revision })))
    .rejects.toThrow(/scope|private|reference|unavailable/i);
});

test.each(['success', 'review', 'snapshot', 'activation'])('host-authored safe references retain transitive guards at %s', async phase => {
  const f = await fixture(), { fact, summary } = await chain(f), scene = await f.put('standalone');
  await appendFile(join(f.root, scene.path), `\nUses [[${summary.path}]].\n`);
  const changed = { ...scene, revision: (await f.fs.readNote(scene.path)).revision };
  if (phase !== 'success') {
    const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
    vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (params, guards, policy) => {
      const target = phase === 'review' ? params.path.includes('/Reviews/') : phase === 'snapshot' ? params.path.includes('/Adoptions/') : params.path.endsWith('/Project.md');
      if (target) await appendFile(join(f.root, fact.path), '\nHost-linked source changed before commit.\n');
      return original(params, guards, policy);
    });
    await expect(f.execute(phase === 'review' ? 'review' : 'adopt', phase === 'review' ? await f.reviewParams(changed) : await f.adoptParams(changed)))
      .rejects.toThrow(/revision|stale|changed/i);
    expect((await f.fs.readNote('Community/Stories/novel/Project.md')).frontmatter.adopted).toEqual({});
  } else {
    for (const operation of ['review', 'adopt']) {
      const result = await f.execute(operation, operation === 'review' ? await f.reviewParams(changed) : await f.adoptParams(changed));
      expect((await f.fs.readNote(result.path)).frontmatter.source_revisions).toEqual(expect.arrayContaining(
        [fact, summary].map(n => ({ path: n.path, expectedRevision: n.revision }))));
    }
  }
});

test('host-authored cyclic YAML data is rejected by the bounded dependency scan', async () => {
  const f = await fixture(), scene = await f.put('scene');
  const data: StoryParams = { purpose: 'ordinary text' }; data.loop = data;
  const changed = await f.edit(scene.path, { data });
  expect(changed.frontmatter.data.loop).toBe(changed.frontmatter.data);
  await expect(f.service.workspace.dependencyGuards({ ...changed, revision: changed.revision! }, f.actors.owner)).rejects.toThrow(/cycl|budget|bound/i);
});

test('host-authored oversized value collections fail closed without unbounded traversal', async () => {
  const f = await fixture(), scene = await f.put('scene');
  const changed = await f.edit(scene.path, { data: { values: Array.from({ length: 8200 }, () => 'text') } });
  await expect(f.service.workspace.dependencyGuards({ ...changed, revision: changed.revision! }, f.actors.owner)).rejects.toThrow(/budget|bound|limit/i);
});
