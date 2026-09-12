import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'topic-packet-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const packet = (options: Record<string, unknown> = {}) => (wiki as any).topicPacket(undefined, { mocPath: 'Map.md', ...options });
async function seed() {
  await fs.writeNote({ path: 'Map.md', content: '# Map\n[[b.md]]\n[[a.md]]', frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'Original.md', content: 'Original observation', frontmatter: { llm_wiki_type: 'source' } });
  for (const id of ['a', 'b']) await fs.writeNote({ path: `${id}.md`, content: `# ${id}`, frontmatter: {
    llm_wiki_type: 'knowledge', note_kind: 'atomic', primary_moc: 'Map.md', nav_order: id === 'a' ? 0 : 1,
    claims: [{ id, statement: `Claim ${id}`, applies_when: 'Condition A' }],
    open_questions: ['What changes in winter?'], evidence_paths: ['Original.md'],
    ...(id === 'b' && { knowledge_role: 'counterargument', contradicts: ['a.md'] }),
  } });
}
test('topic packet keeps authored MOC order and returns pinned sources without publishing', async () => {
  await seed(); const revision = await fs.readNoteRevision('Map.md');
  const result = await packet();
  expect(result.items.map((x: any) => x.path)).toEqual(['b.md', 'a.md']);
  expect(result.items[0]).toMatchObject({ counterpoint: true, claims: [{ statement: 'Claim b', appliesWhen: 'Condition A' }] });
  expect(result.items[0].sourceReads[0]).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Original.md', expectedRevision: await fs.readNoteRevision('Original.md') } });
  expect(result.coverage).toMatchObject({ selected: 2, completeMembership: true });
  expect(result.publication).toMatchObject({ endpointId: 'mcp.publish_knowledge', automatic: false });
  expect(await fs.readNoteRevision('Map.md')).toBe(revision);
  expect(await fs.noteExists('Synthesis.md')).toBe(false);
});
test('sampling and query retain order and never claim complete topic coverage', async () => {
  await seed(); const result = await packet({ limit: 1, query: 'winter' });
  expect(result.items.map((x: any) => x.path)).toEqual(['b.md']);
  expect(result.partial).toBe(true); expect(result.coverage.completeTopic).toBe(false);
  expect(result.nextAction.endpointId).toBe('notes.read');
});
test('new MOC members require review even when every saved input revision matches', async () => {
  await seed(); const inputs = await Promise.all(['a', 'b'].map(async id => ({ id, path: `${id}.md`, revision: await fs.readNoteRevision(`${id}.md`) })));
  const record = { question: 'When?', inputs, explanations: inputs.map(({ id }) => ({ id, explanation: id, appliesWhen: id, limitations: 'Conditional only', basis: [id] })), choices: [], counterexamples: [], unresolvedQuestions: ['Which condition?'] };
  await fs.writeNote({ path: 'c.md', content: 'New member', frontmatter: { note_kind: 'atomic', llm_wiki_type: 'knowledge', primary_moc: 'Map.md' } });
  await fs.writeNote({ path: 'Synthesis.md', content: 'Saved interpretation', frontmatter: {
    llm_wiki_type: 'knowledge', note_kind: 'knowledge', primary_moc: 'Map.md', knowledge_synthesis: record,
  } });
  const revision = await fs.readNoteRevision('Synthesis.md'); const result = await packet({ maxChars: 16000 });
  expect(result.existingSynthesis).toMatchObject({ path: 'Synthesis.md', revision, inputBasis: { state: 'current_revisions' }, topicState: 'review_required' });
  expect(result.publication.arguments).toMatchObject({ path: 'Synthesis.md', expectedRevision: revision });
  expect((await fs.readNote('Synthesis.md')).frontmatter.knowledge_synthesis).toEqual(record);
});
test('hidden members and source identities never appear in packet or aggregates', async () => {
  await seed(); const allowed = access.canAccessPhysicalPath.bind(access);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((p, principal) => !['a.md', 'Original.md'].includes(p) && allowed(p, principal));
  const result = await packet(); const text = JSON.stringify(result);
  expect(text).not.toContain('a.md'); expect(text).not.toContain('Original.md');
  expect(result.items).toHaveLength(1);
});
test('last-read revocation discards the packet', async () => {
  await seed(); const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const revision = await read(...args); vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return revision;
  });
  await expect(packet()).rejects.toThrow(/unavailable|changed|denied|visibility/i);
});
test.each([768, 2000, 7000])('entire formatted packet fits %i characters', async maxChars => {
  await seed(); const result = await packet({ maxChars, prettyPrint: true });
  expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(maxChars);
});
test.each([{ mocPath: '../outside.md' }, { mocPath: 'a.md' }, { limit: 9 }, { maxChars: 16001 }])('rejects invalid topic arguments %j', async options => {
  await seed(); await expect(packet(options)).rejects.toThrow();
});

test('metadata admission is capped and a large MOC keeps original-read capacity', async () => {
  await seed();
  for (let i = 0; i < 70; i++) await fs.writeNote({ path: `z${i}.md`, content: 'Member', frontmatter: { note_kind: 'atomic', primary_moc: 'Map.md' } });
  const read = vi.spyOn(fs, 'readNoteMetadata'); const result = await packet();
  expect(read.mock.calls.flatMap(call => call[0]).length).toBeLessThanOrEqual(64);
  expect(result.partial).toBe(true); expect(result.coverage.completeMembership).toBe(false);
  expect(result.items[0].sourceReads[0].arguments.path).toBe('Original.md');
});
test('new membership during a request invalidates its old topic context', async () => {
  await seed(); const backlinks = fs.getBacklinks.bind(fs); let calls = 0;
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    if (++calls === 2) await fs.writeNote({ path: 'New.md', content: 'New', frontmatter: { note_kind: 'atomic', primary_moc: 'Map.md' } });
    return backlinks(...args);
  });
  await expect(packet()).rejects.toThrow(/changed/i);
});
test('source read actions preserve authored exact locators and mark stale evidence', async () => {
  await seed(); const note = await fs.readNote('b.md');
  await fs.writeNote({ path: 'b.md', content: note.content, frontmatter: { ...note.frontmatter,
    evidence_paths: [], evidence: [{ path: 'Original.md', revision: 'a'.repeat(64), heading: 'Observation', startLine: 2, endLine: 3 }],
  } });
  const result = await packet();
  expect(result.items[0].sourceReads[0]).toMatchObject({ basisState: 'review_required', recordedRevision: 'a'.repeat(64),
    locator: { heading: 'Observation', startLine: 2, endLine: 3 } });
});
test('MOC examples inside fences are not selected as authored members', async () => {
  await seed(); await fs.writeNote({ path: 'Example.md', content: 'Only an example', frontmatter: { note_kind: 'atomic' } });
  await fs.writeNote({ path: 'Map.md', content: '# Map\n~~~md\n[[Example.md]]\n~~~\n[[b.md]]', frontmatter: { note_kind: 'moc' } });
  const result = await packet(); expect(JSON.stringify(result)).not.toContain('Example.md');
});

test('link overflow cannot disclose an unchecked hidden reference', async () => {
  await seed(); const b = await fs.readNote('b.md');
  await fs.writeNote({ path: 'Hidden.md', content: 'Hidden', frontmatter: { moderation_status: 'hidden' } });
  await fs.writeNote({ path: 'b.md', content: b.content, frontmatter: { ...b.frontmatter,
    claims: [{ statement: '[[b.md]] '.repeat(17) + '[[Hidden.md|Sensitive label]]' }],
  } });
  const value = JSON.stringify(await packet()); expect(value).not.toContain('Hidden.md'); expect(value).not.toContain('Sensitive label');
});
test('wikilink MOC Properties members are included without requiring a body link', async () => {
  await seed(); await fs.writeNote({ path: 'Declared.md', content: 'Member', frontmatter: { note_kind: 'atomic', primary_moc: '[[Map.md]]' } });
  expect((await packet({ maxChars: 16000 })).items.map((x: any) => x.path)).toContain('Declared.md');
});
test('unrelated moderation-hidden alias candidates do not change public inspection counts', async () => {
  await seed(); await fs.writeNote({ path: 'Map.md', content: '# Map\n[[b]]', frontmatter: { note_kind: 'moc' } });
  const first = await packet();
  await fs.writeNote({ path: 'Hidden.md', content: 'Hidden', frontmatter: { moderation_status: 'hidden' } });
  const second = await packet(); expect(second.metadataInspected).toEqual(first.metadataInspected);
});
test('a new ambiguous body target invalidates the old unique resolution', async () => {
  await fs.writeNote({ path: 'Map.md', content: '# Map\n[[topic.md]]', frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'A/topic.md', content: 'A', frontmatter: { note_kind: 'atomic' } });
  const backlinks = fs.getBacklinks.bind(fs); let count = 0;
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    if (++count === 2) await fs.writeNote({ path: 'B/topic.md', content: 'B', frontmatter: { note_kind: 'atomic' } });
    return backlinks(...args);
  });
  await expect(packet()).rejects.toThrow(/changed/i);
});

test('a MOC property and support edge to the same target retain separate provenance', async () => {
  await seed(); await fs.writeNote({ path: 'Declared.md', content: 'Member', frontmatter: {
    note_kind: 'atomic', primary_moc: '[[Map.md]]', supports: ['[[Map.md]]'],
  } });
  expect((await packet({ maxChars: 16000 })).items.map((x: any) => x.path)).toContain('Declared.md');
});
test('final ambiguity checks fail closed when new candidate metadata cannot fit', async () => {
  const links = ['[[topic.md]]'];
  for (let i = 0; i < 62; i++) {
    const path = `n${i}.md`; links.push(`[[${path}]]`);
    await fs.writeNote({ path, content: path, frontmatter: { note_kind: 'atomic' } });
  }
  await fs.writeNote({ path: 'Map.md', content: links.join('\n'), frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'A/topic.md', content: 'A', frontmatter: { note_kind: 'atomic' } });
  const backlinks = fs.getBacklinks.bind(fs); let count = 0;
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    if (++count === 2) await fs.writeNote({ path: 'B/topic.md', content: 'B', frontmatter: { note_kind: 'atomic' } });
    return backlinks(...args);
  });
  await expect(packet()).rejects.toThrow(/changed/i);
});

test('ambiguous reverse MOC properties do not establish membership', async () => {
  for (const path of ['A/Map.md', 'B/Map.md']) await fs.writeNote({ path, content: '# Map', frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'Member.md', content: 'Member', frontmatter: { note_kind: 'atomic', primary_moc: '[[Map.md]]' } });
  const result = await packet({ mocPath: 'A/Map.md' });
  expect(result.items).toEqual([]); expect(result.coverage.completeMembership).toBe(false);
});
test('distinct heading and block evidence citations survive document deduplication', async () => {
  await seed(); const b = await fs.readNote('b.md');
  await fs.writeNote({ path: 'b.md', content: b.content, frontmatter: { ...b.frontmatter,
    evidence_paths: ['[[Original.md#Finding A]]', '[[Original.md#^finding-b]]'],
  } });
  const result = await packet();
  expect(result.items[0].sourceReads).toHaveLength(2);
  expect(result.items[0].sourceReads[0].locator).toMatchObject({ heading: 'Finding A' });
  expect(result.items[0].sourceReads[1].locator).toMatchObject({ blockId: 'finding-b' });
});
test('unhiding a cached negative candidate invalidates a unique selection', async () => {
  await fs.writeNote({ path: 'Map.md', content: '[[topic.md]]', frontmatter: { note_kind: 'moc' } });
  await fs.writeNote({ path: 'A/topic.md', content: 'A', frontmatter: { note_kind: 'atomic' } });
  await fs.writeNote({ path: 'B/topic.md', content: 'B', frontmatter: { note_kind: 'atomic', moderation_status: 'hidden' } });
  const backlinks = fs.getBacklinks.bind(fs); let count = 0;
  vi.spyOn(fs, 'getBacklinks').mockImplementation(async (...args) => {
    if (++count === 2) await fs.writeNote({ path: 'B/topic.md', content: 'B', frontmatter: { note_kind: 'atomic' } });
    return backlinks(...args);
  });
  await expect(packet()).rejects.toThrow(/changed/i);
});

test('Markdown MOC property destinations use Markdown resolution', async () => {
  await seed(); await fs.writeNote({ path: 'Member.md', content: 'Member', frontmatter: {
    note_kind: 'atomic', primary_moc: '[Map](Map.md)',
  } });
  expect((await packet({ maxChars: 16000 })).items.map((x: any) => x.path)).toContain('Member.md');
});
