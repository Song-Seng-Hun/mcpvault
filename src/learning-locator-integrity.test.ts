import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { ContinuityService } from './continuity.js';

const vaults: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const vault of vaults.splice(0)) await rm(vault, { recursive: true, force: true }); });
async function fixture(link: string, body = '# Lesson\nParagraph ^lesson\n') {
  const vault = await mkdtemp(join(tmpdir(), 'mcpvault-learning-locator-')); vaults.push(vault);
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  const continuity = new ContinuityService(fs, { access, buildLearningPath: (p, path, depth, limit, chars) => wiki.learningPath(p, path, depth, limit, chars, true) });
  await fs.writeNote({ path: 'MOC.md', content: link, frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'A.md', content: body, frontmatter: { note_kind: 'atomic' } });
  const save = () => continuity.save({ principal, topic: 'Learn', summary: 'Start', nextAction: 'Read target', learningProgress: { rootPath: 'MOC.md' } });
  return { fs, wiki, principal, continuity, save, checkpoint: '_scopes/agents/worker/_continuity/work-state.md' };
}

test.each(['[[A#Missing]]', '[[A#^missing]]', '[[A#Lesson]]\n[[A#Missing]]', '[[A#^lesson]]\n[[A#^missing]]'])('missing authored locator is incomplete even on a repeated document: %s', async link => {
  const { fs, wiki, principal, save, checkpoint } = await fixture(link);
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(result.navigationComplete).toBe(false);
  expect(result.navigationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'unresolved_body_locator', target: 'A.md' })]));
  expect(result.authoredOrder.map(item => item.path)).toEqual(['A.md']);
  await expect(save()).rejects.toThrow(/locator|heading|block|unresolved/);
  expect(await fs.noteExists(checkpoint)).toBe(false);
});

test.each([
  { link: '[[A#Phantom]]', body: '```md\n# Phantom\n```\n# Lesson' },
  { link: '[[A#^phantom]]', body: '~~~md\nText ^phantom\n~~~\n# Lesson' },
  { link: '[[A#^phantom]]', body: 'Text ^phantom-suffix\nText ^phantom followed by prose' },
])('fenced or non-anchor examples cannot satisfy $link', async ({ link, body }) => {
  const { wiki, principal } = await fixture(link, body);
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(result.navigationComplete).toBe(false);
});

test('valid section and block links permit saving and preserve compact locator hints', async () => {
  const { wiki, principal, save } = await fixture('[[A#Lesson]]\n[[A#^lesson]]');
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 1024);
  expect(result.navigationComplete).toBe(true);
  expect(result.authoredOrder[0]).toMatchObject({ path: 'A.md', targetHeading: 'Lesson' });
  expect((await save()).success).toBe(true);
});

test('removing an anchor invalidates resume without rewriting the checkpoint', async () => {
  const { fs, continuity, principal, save, checkpoint } = await fixture('[[A#^lesson]]');
  await save();
  const before = await fs.readNote(checkpoint);
  await fs.writeNote({ path: 'A.md', content: '# Still exists without the target anchor' });
  const result = await continuity.read({ principal });
  expect(result.learningProgress).toMatchObject({ state: 'stale', canResume: false });
  expect(result.learningProgress?.next).toBeUndefined();
  expect(result.learningProgress?.drift?.validationError).toMatch(/locator|heading|block|unresolved/);
  expect((await fs.readNote(checkpoint)).revision).toBe(before.revision);
});

test('multiple locators in one document share one bounded validation body read', async () => {
  const { fs, wiki, principal } = await fixture('[[A#Lesson]]\n[[A#^lesson]]\n[[A#Missing]]');
  const reads = vi.spyOn(fs, 'readNote');
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(result.navigationComplete).toBe(false);
  expect(reads.mock.calls.filter(([path]) => path === 'A.md')).toEqual([['A.md', 8 * 1024 * 1024]]);
});

test('compact incomplete paths retain the navigation gate even when diagnostics are omitted', async () => {
  const { wiki, principal } = await fixture('[[A#Missing]]');
  for (const pretty of [false, true]) {
    const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 1024, false, pretty);
    expect(result.navigationComplete).toBe(false);
    expect(JSON.stringify(result, null, pretty ? 2 : undefined).length).toBeLessThanOrEqual(1024);
  }
});

test('ordinary whole-note links do not trigger locator hydration', async () => {
  const { fs, wiki, principal } = await fixture('[[A]]');
  const reads = vi.spyOn(fs, 'readNote');
  expect((await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000)).navigationComplete).toBe(true);
  expect(reads.mock.calls.filter(([path]) => path === 'A.md')).toEqual([]);
});

test('nested MOC diagnostics preserve their source and allow deliberate repair', async () => {
  const { fs, wiki, principal, save } = await fixture('[[Nested]]');
  await fs.writeNote({ path: 'Nested.md', content: '[[A#Missing]]', frontmatter: { note_kind: 'moc' } });
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(result.navigationComplete).toBe(false);
  expect(result.navigationIssues).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'unresolved_body_locator', moc: 'Nested.md', target: 'A.md', targetHeading: 'Missing' })]));
  await fs.writeNote({ path: 'A.md', content: '# Missing\nNow available.' });
  expect((await save()).success).toBe(true);
});

test('inaccessible locator targets are never hydrated or disclosed', async () => {
  const { fs, wiki, principal } = await fixture('[[Secret#Hidden]]');
  const hidden = '_scopes/agents/other/Secret.md';
  await fs.writeNote({ path: hidden, content: '# Hidden\nPRIVATE-MARKER' });
  const reads = vi.spyOn(fs, 'readNote');
  const result = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(result.navigationComplete).toBe(false);
  expect(reads.mock.calls.some(([path]) => path === hidden)).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE-MARKER');
  expect(JSON.stringify(result)).not.toContain('_scopes/agents/other');
});

test('case-normalized percent-encoded heading names and terminal blocks remain valid', async () => {
  const { wiki, principal, save } = await fixture('[[A#%ED%95%99%EC%8A%B5%20Lesson]]\n[[A#^LESSON]]', '# 학습 Lesson ###\nText ^lesson\n');
  expect((await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000)).navigationComplete).toBe(true);
  expect((await save()).success).toBe(true);
});

test('qualified subsections work consistently for MOC checkpoints, section reads and split previews', async () => {
  const body = '# Course\n## First\n### Lesson\nWRONG-BRANCH\n## Second\n### Lesson\nRIGHT-BRANCH\n# End\n';
  const { wiki, principal, save } = await fixture('[[A#Course#Second#Lesson]]', body);
  const path = await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000);
  expect(path.navigationComplete).toBe(true);
  expect((await save()).success).toBe(true);
  const section = await wiki.readProjection({ principal, path: 'A.md', view: 'section', section: 'Course#Second#Lesson', maxChars: 4000 });
  expect(section.content).toContain('RIGHT-BRANCH');
  expect(section.content).not.toContain('WRONG-BRANCH');
  const split = await wiki.previewSplit({ principal, path: 'A.md', heading: 'Course#Second#Lesson', maxChars: 4000 });
  expect(split.content).toContain('RIGHT-BRANCH');
  expect(split.content).not.toContain('WRONG-BRANCH');
  expect(split.sourceRevision).toBe(section.revision);
});

test('a qualified heading cannot join unrelated branches merely because both titles exist', async () => {
  const { wiki, principal, save } = await fixture('[[A#First#Lesson]]', '# First\n# Second\n## Lesson\n');
  expect((await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000)).navigationComplete).toBe(false);
  await expect(save()).rejects.toThrow(/locator|heading|block/);
});

test('Setext source anchors support checkpoints and section ranges without losing underline lines', async () => {
  const body = 'Course\n===\n\nLesson\n---\nRIGHT-BRANCH\n\nOther\n---\nWRONG-BRANCH\n';
  const { fs, wiki, principal, save, continuity } = await fixture('[[A#Course#Lesson]]', body);
  const before = await fs.readNote('A.md');
  expect((await wiki.learningPath(principal, 'MOC.md', 2, 30, 16000)).navigationComplete).toBe(true);
  expect((await save()).success).toBe(true);
  const section = await wiki.readProjection({ principal, path: 'A.md', view: 'section', section: 'Course#Lesson' });
  const split = await wiki.previewSplit({ principal, path: 'A.md', heading: 'Course#Lesson' });
  expect(section.content).toBe('Lesson\n---\nRIGHT-BRANCH');
  expect(split.content).toBe(section.content);
  expect(split.sourceRevision).toBe(before.revision);
  expect((await fs.readNote('A.md')).revision).toBe(before.revision);
  await fs.writeNote({ path: 'A.md', content: body.replace('Lesson\n---', 'Lesson\n\n---'), expectedRevision: before.revision });
  expect((await continuity.read({ principal })).learningProgress).toMatchObject({ state: 'stale', canResume: false });
});
