import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { WorkService } from './work-service.js';
import { StoryWorkspace } from './story-workspace.js';
import { StoryProjects } from './story-projects.js';
import { StoryArtifacts } from './story-artifacts.js';
import { StoryEditorial } from './story-editorial.js';
import { FrontmatterHandler } from './frontmatter.js';
import type { StoryParams } from './story-model.js';

const module = await import('./story-exports.js').catch(() => ({})) as typeof import('./story-exports.js');
beforeEach(() => expect(module.StoryExports, 'StoryExports exists').toBeTypeOf('function'));
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'story-exports-')); roots.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), auth = new ScopeAuthService(root);
  const refs = new ReferenceService(fs, access), tasks = new AgentTaskService(fs, refs, auth), work = new WorkService(fs, refs, auth, tasks);
  const actors: Record<string, ScopePrincipal> = {};
  for (const id of ['owner', 'writer', 'outsider']) actors[id] = (await auth.register({ accountId: id, modelId: id, password: 'fixture-password-only' })).principal;
  const w = new StoryWorkspace(fs, access, refs, auth, work, tasks), projects = new StoryProjects(w), artifacts = new StoryArtifacts(w), editorial = new StoryEditorial(w);
  const exports = new module.StoryExports(w);
  await projects.execute({ op: 'create', projectId: 'novel', title: '기억의 도서관', brief: { medium: 'screenplay' },
    participants: ['writer'], expectedRevision: 'missing', requestId: 'create' }, actors.owner);
  let counter = 0;
  const project = () => w.project('novel', actors.owner);
  const put = async (id: string, extra: StoryParams = {}) => artifacts.execute({ op: 'create', projectId: 'novel', artifactId: id,
    kind: 'scene', title: '도서관 - 밤', content: '원래 장면', branchId: 'main', data: { blocks: [{ type: 'heading', text: '도서관 - 밤' }, { type: 'character', text: '민수' }, { type: 'dialogue', text: '기억나.' }] },
    expectedRevision: 'missing', expectedProjectRevision: (await project()).revision, requestId: `put-${++counter}`, ...extra }, actors.writer);
  const sequence = async (presentation: string[], shots: string[] = []) => projects.sequence({ op: 'update', projectId: 'novel', presentation,
    chronology: [...presentation].reverse(), shots, expectedRevision: (await project()).revision, requestId: `sequence-${++counter}` }, actors.owner);
  const adopt = async (id: string) => editorial.adopt({ projectId: 'novel', artifactId: id, sourceRevision: (await w.artifact('novel', id, actors.owner)).revision,
    expectedRevision: 'missing', expectedProjectRevision: (await project()).revision, requestId: `adopt-${++counter}`, reason: 'Selected.' }, actors.owner);
  const execute = (params: StoryParams = {}, actor = actors.owner) => exports.execute({ projectId: 'novel', ...params }, actor);
  const write = async (extra: StoryParams = {}) => execute({ op: 'write', exportId: 'book', format: 'markdown', selection: 'draft',
    expectedRevision: 'missing', expectedProjectRevision: (await project()).revision, requestId: `export-${++counter}`, ...extra });
  return { root, fs, w, actors, projects, artifacts, exports, project, put, sequence, adopt, execute, write };
}

test('adopted exports pin selected immutable snapshot and original source revision after a draft edit', async () => {
  const f = await fixture(); const draft = await f.put('scene'); await f.sequence(['scene']); const adopted = await f.adopt('scene');
  await f.put('scene', { op: 'update', expectedRevision: draft.revision, content: '未採用-CHANGED-DRAFT' });
  const preview = await f.execute({ format: 'markdown', maxChars: 12000 });
  expect(preview.content).toContain('원래 장면'); expect(preview.content).not.toContain('CHANGED-DRAFT');
  expect(preview.sources).toEqual([expect.objectContaining({ artifactId: 'scene', path: adopted.path, revision: adopted.revision, sourceRevision: draft.revision })]);
  expect(preview.stale).toBe(true);
  const saved = await f.write({ selection: 'adopted' });
  expect((await f.fs.readNote(saved.path)).revision).toBe(saved.revision);
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: true, outputChanged: false });
});

test.each(['markdown', 'fountain', 'storyboard', 'canvas'])('writes exact %s output and bounded managed manifest result', async format => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']);
  const preview = await f.execute({ format, selection: 'draft', maxChars: 12000 });
  const saved = await f.write({ format, maxChars: 12000 });
  const raw = await readFile(join(f.root, saved.outputPath), 'utf8');
  expect(raw).toBe(preview.content);
  expect(createHash('sha256').update(raw).digest('hex')).toBe(saved.outputRevision);
  expect((await f.fs.readNote(saved.path)).revision).toBe(saved.revision);
  expect(JSON.stringify(saved).length).toBeLessThanOrEqual(12000);
  if (format === 'canvas') expect(JSON.parse(raw).nodes.every((node: StoryParams) => node.type === 'file')).toBe(true);
  if (format === 'fountain') expect(saved.outputPath).toMatch(/\.fountain$/);
  expect(await f.execute({ op: 'read', exportId: 'book' })).toMatchObject({ stale: false, outputChanged: false });
});

test('preserves authored sequences, rejects unselected adopted scenes and isolates alternate branches', async () => {
  const f = await fixture(); await f.put('b', { content: 'SECOND' }); await f.put('a', { content: 'FIRST' });
  await f.put('alternate', { branchId: 'alternate', content: 'OTHER-BRANCH' }); await f.sequence(['a', 'b']);
  await expect(f.execute({ format: 'markdown' })).rejects.toThrow(/adopt|selected/i);
  const result = await f.execute({ format: 'markdown', selection: 'draft', maxChars: 12000 });
  expect(result.content.indexOf('FIRST')).toBeLessThan(result.content.indexOf('SECOND'));
  expect(result.content).not.toContain('OTHER-BRANCH');
  expect(result.sequences).toEqual({ presentation: ['a', 'b'], chronology: ['b', 'a'], shots: [] });
});

test('health tracks sequence and dependency revisions without replacing selected bodies', async () => {
  const f = await fixture(); const dep = await f.put('setting', { kind: 'place', data: {}, content: 'Old setting' });
  await f.put('scene', { sources: [{ artifactId: 'setting', revision: dep.revision }] }); await f.sequence(['scene']);
  await f.write();
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: false });
  await f.put('setting', { op: 'update', kind: 'place', data: {}, expectedRevision: dep.revision, content: 'Changed setting' });
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: true });
  await f.sequence([]);
  expect((await f.execute({ op: 'health', exportId: 'book', maxChars: 12000 })).staleReasons).toContain('sequence_changed');
});

test('binary image pins distinguish invalid UTF8 bytes, missing images are flagged, private image references are denied', async () => {
  const f = await fixture(); const scene = await f.put('scene');
  await mkdir(join(f.root, 'Images')); await writeFile(join(f.root, 'Images/frame.png'), Buffer.from([0xff, 0x00]));
  const shot = await f.put('shot', { kind: 'shot', data: { sourceSceneId: 'scene', sourceSceneRevision: scene.revision, order: 1, durationSeconds: 1,
    images: [{ path: 'Images/frame.png' }, { path: 'Images/missing.png' }] } });
  await f.sequence(['scene'], ['shot']);
  const saved = await f.write({ format: 'canvas', maxChars: 12000 });
  expect(JSON.stringify(saved.diagnostics)).toContain('missing_image');
  await writeFile(join(f.root, 'Images/frame.png'), Buffer.from([0xfe, 0x00]));
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: true });
  const shotRaw = await readFile(join(f.root, shot.path), 'utf8');
  await writeFile(join(f.root, shot.path), shotRaw.replace('Images/frame.png', '_scopes/models/owner/private.png'), 'utf8');
  await expect(f.execute({ format: 'canvas', selection: 'draft' })).rejects.toThrow(/image|scope|unavailable/i);
});

test('never overwrites an unmanaged or manually changed output and reports changed health', async () => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']); const saved = await f.write({ format: 'canvas' });
  const raw = '{"nodes":[],"edges":[]}'; await writeFile(join(f.root, saved.outputPath), raw);
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: true, outputChanged: true });
  await expect(f.write({ format: 'canvas', expectedRevision: saved.revision })).rejects.toThrow(/changed|unmanaged|output/i);
  expect(await readFile(join(f.root, saved.outputPath), 'utf8')).toBe(raw);
  await writeFile(join(f.root, 'Community/Stories/novel/Exports/foreign.output.md'), 'USER FILE');
  await expect(f.write({ exportId: 'foreign' })).rejects.toThrow(/unmanaged|output|exists/i);
});

test('replays only the same current output and rejects changed payload or altered manifest', async () => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']);
  const params = { op: 'write', exportId: 'book', selection: 'draft', format: 'markdown', expectedRevision: 'missing', expectedProjectRevision: (await f.project()).revision, requestId: 'same' };
  const saved = await f.execute(params);
  expect(await f.execute(params)).toMatchObject({ revision: saved.revision, replayed: true });
  await expect(f.execute({ ...params, format: 'fountain' })).rejects.toThrow(/payload|format|requestId/i);
  const raw = await readFile(join(f.root, saved.path), 'utf8'); await writeFile(join(f.root, saved.path), `${raw}\nUSER EDIT\n`);
  await expect(f.execute(params)).rejects.toThrow(/changed|external|manifest/i);
});

test.each(['output', 'completion'])('recovers partial %s failure by same-request retry without claiming early success', async phase => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']);
  const params = { op: 'write', exportId: 'book', format: 'markdown', selection: 'draft', expectedRevision: 'missing', expectedProjectRevision: (await f.project()).revision, requestId: 'recover' };
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs); let fail = true;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (write, guards, policy) => {
    if (fail && (phase === 'output' ? write.path.endsWith('.output.md') : write.frontmatter?.status === 'complete')) { fail = false; throw new Error('injected partial write'); }
    return original(write, guards, policy);
  });
  await expect(f.execute(params)).rejects.toThrow(/partial write/);
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ prepared: true, stale: true });
  const saved = await f.execute(params);
  expect(saved).toMatchObject({ prepared: false, status: 'complete' });
  expect((await f.fs.readNote(saved.path)).revision).toBe(saved.revision);
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ prepared: false, stale: false });
});

test('rejects read-only, writer, outsider and stale project writes; rechecks output CAS after preparation', async () => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']);
  const params = { op: 'write', exportId: 'book', format: 'markdown', selection: 'draft', expectedRevision: 'missing', expectedProjectRevision: (await f.project()).revision, requestId: 'permissions' };
  await expect(f.execute(params, f.actors.writer)).rejects.toThrow(/showrunner/i);
  await expect(f.execute(params, f.actors.outsider)).rejects.toThrow(/member|participant/i);
  f.w.options.readOnly = true; await expect(f.execute(params)).rejects.toThrow(/read-only/i); f.w.options.readOnly = false;
  await expect(f.execute({ ...params, expectedProjectRevision: '0'.repeat(64) })).rejects.toThrow(/revision/i);
  const saved = await f.execute(params);
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs); let altered = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (write, guards, policy) => {
    if (!altered && write.path.endsWith('.output.md')) { altered = true; await writeFile(join(f.root, write.path), 'CONCURRENT USER EDIT'); }
    return original(write, guards, policy);
  });
  await expect(f.execute({ ...params, expectedRevision: saved.revision, requestId: 'racing' })).rejects.toThrow(/revision|output|changed/i);
  expect(await readFile(join(f.root, saved.outputPath), 'utf8')).toBe('CONCURRENT USER EDIT');
});

test('bounds preview and replay responses and rejects continuation after draft revision changes', async () => {
  const f = await fixture(); const a = await f.put('scene', { content: '긴 원고 '.repeat(2500) }); await f.sequence(['scene']);
  const first = await f.execute({ format: 'markdown', selection: 'draft', maxChars: 1000 });
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(1000); expect(first.truncated).toBe(true);
  const second = await f.execute({ format: 'markdown', selection: 'draft', maxChars: 1000, cursor: first.cursor });
  expect(second.contentOffset).toBe(first.content.length);
  expect(JSON.stringify(second).length).toBeLessThanOrEqual(1000);
  await f.put('scene', { op: 'update', expectedRevision: a.revision, content: 'Changed content' });
  await expect(f.execute({ format: 'markdown', selection: 'draft', maxChars: 1000, cursor: first.cursor })).rejects.toThrow(/cursor|revision/i);
  const params = { op: 'write', exportId: 'book', format: 'markdown', selection: 'draft', expectedRevision: 'missing', expectedProjectRevision: (await f.project()).revision, requestId: 'bounded', maxChars: 1000 };
  expect(JSON.stringify(await f.execute(params)).length).toBeLessThanOrEqual(1000);
  expect(JSON.stringify(await f.execute(params)).length).toBeLessThanOrEqual(1000);
});

test('bounds serialized UTF8 manifests including accumulated retry receipts before writing', async () => {
  const f = await fixture(); const scene = await f.put('scene'); const shots: string[] = [];
  for (let index = 0; index < 6; index++) {
    const id = `shot-${index}`; shots.push(id);
    await f.put(id, { kind: 'shot', data: { sourceSceneId: 'scene', sourceSceneRevision: scene.revision, order: index, durationSeconds: 1,
      images: Array.from({ length: 12 }, (_, image) => ({ path: `Images/${'한'.repeat(130)}/${'글'.repeat(130)}/${'자'.repeat(130)}-${image}.png` })) } });
  }
  await f.sequence(['scene'], shots);
  let revision = 'missing'; let bounded = false;
  for (let index = 0; index < 8; index++) {
    try {
      await f.write({ format: 'canvas', expectedRevision: revision, maxChars: 12000 });
    } catch (error) {
      expect(String(error)).toMatch(/manifest.*bound/i); bounded = true;
    }
    const path = 'Community/Stories/novel/Exports/book.md';
    if (await f.fs.noteExists(path)) {
      const raw = await readFile(join(f.root, path));
      expect(raw.byteLength).toBeLessThanOrEqual(400000);
      revision = (await f.fs.readNote(path)).revision!;
    }
    if (bounded) break;
  }
  expect(bounded).toBe(true);
}, 60000);

test.each(['explicit', 'body', 'transitive-pin', 'transitive-reference', 'transitive-body', 'stale-pin'])
('rejects alternate-branch %s references introduced by an external Markdown edit', async mode => {
  const f = await fixture(); const alternate = await f.put('alternate', { branchId: 'alternate', content: 'FOREIGN-BRANCH' });
  const middle = await f.put('middle', { kind: 'place', data: {} });
  const scene = await f.put('scene', { data: {} }); await f.sequence(['scene']);
  const edit = async (path: string, fields: StoryParams, content?: string) => {
    const note = await f.fs.readNote(path);
    await writeFile(join(f.root, path), new FrontmatterHandler().stringify({ ...note.frontmatter, ...fields }, content ?? note.content));
    return (await f.fs.readNote(path)).revision!;
  };
  if (mode === 'explicit') await edit(scene.path, { references: [alternate.path] });
  else if (mode === 'body') await edit(scene.path, {}, `An authored link: [[${alternate.path}]]`);
  else if (mode === 'stale-pin') await edit(scene.path, { source_revisions: [{ path: alternate.path, expectedRevision: '0'.repeat(64) }] });
  else {
    const revision = mode === 'transitive-pin'
      ? await edit(middle.path, { source_revisions: [{ path: alternate.path, expectedRevision: alternate.revision }] })
      : mode === 'transitive-reference' ? await edit(middle.path, { references: [alternate.path] })
        : await edit(middle.path, {}, `Nested authored link: [[${alternate.path}]]`);
    await edit(scene.path, { source_revisions: [{ path: middle.path, expectedRevision: revision }] });
  }
  await expect(f.execute({ selection: 'draft' })).rejects.toThrow(/branch|project/i);
  await expect(f.write()).rejects.toThrow(/branch|project/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Exports/book.md')).toBe(false);
});

test('rejects a referenced story note with externally changed project identity', async () => {
  const f = await fixture(); const reference = await f.put('setting', { kind: 'place', data: {} });
  await f.put('scene', { references: [reference.path], data: {} }); await f.sequence(['scene']);
  const note = await f.fs.readNote(reference.path);
  await writeFile(join(f.root, reference.path), new FrontmatterHandler().stringify({ ...note.frontmatter, project_id: 'foreign' }, note.content));
  await expect(f.write()).rejects.toThrow(/project/i);
  expect(await f.fs.noteExists('Community/Stories/novel/Exports/book.md')).toBe(false);
});

test('output authorization callback rejects changed held output before delegating to filesystem CAS', async () => {
  const f = await fixture(); await f.put('scene'); await f.sequence(['scene']); const saved = await f.write();
  const original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs); let callbackRejected = false;
  vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (write, guards, policy) => {
    if (write.path === saved.outputPath) {
      await writeFile(join(f.root, write.path), 'USER EDIT DURING AUTHORIZATION');
      try { await policy!.assertAccess!(); } catch (error) { callbackRejected = true; throw error; }
    }
    return original(write, guards, policy);
  });
  await expect(f.write({ expectedRevision: saved.revision })).rejects.toThrow(/output|revision|changed/i);
  expect(callbackRejected).toBe(true);
  expect(await readFile(join(f.root, saved.outputPath), 'utf8')).toBe('USER EDIT DURING AUTHORIZATION');
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ prepared: true, outputChanged: true });
});

test.each([123, 124])('source guard boundary with %i dependencies never persists an unreadable complete export', async count => {
  const f = await fixture(); const scene = await f.put('scene', { data: {} }); await f.sequence(['scene']);
  await mkdir(join(f.root, 'References'));
  const dependencies = await Promise.all(Array.from({ length: count }, async (_, index) => {
    const path = `References/dependency-${index}.md`, content = `Reference ${index}\n`;
    await writeFile(join(f.root, path), content);
    return { path, expectedRevision: createHash('sha256').update(content).digest('hex') };
  }));
  const note = await f.fs.readNote(scene.path);
  await writeFile(join(f.root, scene.path), new FrontmatterHandler().stringify({ ...note.frontmatter, source_revisions: dependencies }, note.content));
  if (count === 123) {
    const saved = await f.write();
    expect(saved.status).toBe('complete');
    expect((await f.execute({ op: 'health', exportId: 'book', field: 'stale' })).content).toBe('false');
    expect((await f.execute({ op: 'read', exportId: 'book', field: 'status' })).content).toBe('"complete"');
  } else {
    await expect(f.write()).rejects.toThrow(/guard.*bound/i);
    expect(await f.fs.noteExists('Community/Stories/novel/Exports/book.md')).toBe(false);
    expect(await f.fs.noteExists('Community/Stories/novel/Exports/book.output.md')).toBe(false);
  }
}, 60000);

test.each(['manifest', 'output'])('rejects its own %s dependency before changing a complete export', async target => {
  const f = await fixture(); const scene = await f.put('scene', { data: {} }); await f.sequence(['scene']); const saved = await f.write();
  const note = await f.fs.readNote(scene.path), reference = target === 'manifest' ? saved.path : saved.outputPath;
  await writeFile(join(f.root, scene.path), new FrontmatterHandler().stringify({ ...note.frontmatter, references: [reference] }, note.content));
  const beforeManifest = await readFile(join(f.root, saved.path)), beforeOutput = await readFile(join(f.root, saved.outputPath));
  await expect(f.write({ expectedRevision: saved.revision })).rejects.toThrow();
  expect((await readFile(join(f.root, saved.path))).equals(beforeManifest), 'manifest bytes preserved').toBe(true);
  expect((await readFile(join(f.root, saved.outputPath))).equals(beforeOutput), 'output bytes preserved').toBe(true);
  expect((await f.fs.readNote(saved.path)).frontmatter.status).toBe('complete');
});

test('raw output health detects invalid UTF8 bytes that decode to the original replacement character', async () => {
  const f = await fixture(); await f.put('scene', { content: 'UTF8 replacement: \ufffd', data: {} }); await f.sequence(['scene']);
  const saved = await f.write(), raw = await readFile(join(f.root, saved.outputPath));
  const offset = raw.indexOf(Buffer.from('\ufffd')); expect(offset).toBeGreaterThanOrEqual(0);
  const invalid = Buffer.concat([raw.subarray(0, offset), Buffer.from([0xff]), raw.subarray(offset + 3)]);
  expect(invalid.toString('utf8')).toBe(raw.toString('utf8'));
  await writeFile(join(f.root, saved.outputPath), invalid);
  expect(await f.execute({ op: 'health', exportId: 'book' })).toMatchObject({ stale: true, outputChanged: true });
  expect((await f.execute({ op: 'read', exportId: 'book' })).content).toBe('');
  await expect(f.write({ expectedRevision: saved.revision })).rejects.toThrow(/changed|UTF8|output/i);
  expect(await readFile(join(f.root, saved.outputPath))).toEqual(invalid);
});

test('expectedRevision checks real export and project revisions while cursors bind the projected view', async () => {
  const f = await fixture(); await f.put('scene', { content: 'Long manuscript. '.repeat(500), data: {} }); await f.sequence(['scene']);
  const saved = await f.write(), projectRevision = (await f.project()).revision;
  for (const op of ['read', 'health', 'preview']) {
    const expectedRevision = op === 'preview' ? projectRevision : saved.revision;
    const params = { op, exportId: 'book', selection: 'draft', expectedRevision, maxChars: 1000 };
    const first = await f.execute(params);
    expect(first.revision).toBe(expectedRevision);
    await expect(f.execute({ ...params, expectedRevision: '0'.repeat(64) })).rejects.toThrow(/revision/i);
    if (op !== 'health') {
      expect(first.cursor).toBeTypeOf('string');
      const next = await f.execute({ ...params, cursor: first.cursor });
      expect(next.contentOffset).toBe(first.content.length);
      expect(next.revision).toBe(expectedRevision);
    }
  }
});
