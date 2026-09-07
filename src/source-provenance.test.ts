import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { SourceProvenanceSession, prepareSourceDerivations } from './source-provenance.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, wiki: LlmWikiService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'source-provenance-'));
  fs = new FileSystemService(root); access = new ScopeAccessPolicy(); wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function source(id: string, extra: Record<string, any> = {}) {
  return wiki.ingestSource({ scopeRoot: '', sourceId: id, title: id, content: id, capturedBy: 'test', sourceWorkId: id, ...extra });
}
const edge = (s: { path: string; revision: string }) => ({ path: s.path, revision: s.revision, relation: 'quotation' });
test('source ingestion persists current pinned derivations and rejects conflicting retry metadata', async () => {
  const original = await source('original');
  const quote = await source('quote', { sourceDerivations: [edge(original)] });
  expect((await fs.readNote(quote.path)).frontmatter.source_derivations).toEqual([edge(original)]);
  expect((await source('quote', { sourceDerivations: [edge(original)] })).created).toBe(false);
  await expect(source('quote', { sourceDerivations: [] })).rejects.toThrow(/derivation|provenance/i);
});
test('different works sharing a recorded original are grouped in claim and answer projections', async () => {
  const original = await source('original');
  const a = await source('a', { sourceDerivations: [edge(original)] });
  const b = await source('b', { sourceDerivations: [edge(original)] });
  await fs.writeNote({ path: 'Knowledge.md', content: 'Claim', frontmatter: { llm_wiki_type: 'knowledge', evidence_paths: [a.path, b.path], claims: [{ id: 'c1', text: 'Claim', evidence_paths: [a.path, b.path] }] } });
  const matrix = await wiki.claimMatrix(undefined, 'Knowledge.md', 20, 16000);
  expect(matrix.authoredOrder[0].evidence.provenance.status).toBe('shared_origin_observed');
  expect(matrix.authoredOrder[0].signals).toContain('shared_source_origin');
  const answer = await wiki.answerPacket(undefined, 'Knowledge.md', 16000, false, 'review');
  expect(JSON.stringify(answer)).toContain('shared_origin_observed');
});
test('ingestion rejects private and Community-to-Global derivations without copying paths', async () => {
  const local = await source('local', { scopeRoot: 'Community' });
  await expect(source('public', { sourceDerivations: [edge(local)] })).rejects.toThrow(/unavailable/i);
  const prepared = await prepareSourceDerivations(fs, access, [edge(local)], 'Community/_sources/other.md');
  expect(prepared.guards[0].expectedRevision).toBe(local.revision);
});
test('source revision guards abort a changed parent before writing its derivative', async () => {
  const original = await source('original');
  const write = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    await writeFile(join(root, original.path), 'changed source outside MCP');
    return write(...args);
  });
  await expect(source('quote', { sourceDerivations: [edge(original)] })).rejects.toThrow(/revision|conflict/i);
  expect(await fs.noteExists('_sources/quote.md')).toBe(false);
});
test('hidden ancestry contributes no identity or hidden group counts', async () => {
  const hidden = await source('secret'); const a = await source('visible', { sourceDerivations: [edge(hidden)] });
  const text = await fs.readNote(hidden.path);
  await writeFile(join(root, hidden.path), text.content); // now no longer a source
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  const result = await session.trace([a.path]);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(result.unresolved).toBe(true);
});
test('final revision and access checks reject an old ancestry projection', async () => {
  const original = await source('original');
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  await session.trace([original.path]);
  await writeFile(join(root, original.path), 'changed');
  await expect(session.validate()).rejects.toThrow(/unavailable|changed/i);
});
test('permission loss during final revision read discards the entire projection', async () => {
  const original = await source('original');
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  await session.trace([original.path]);
  const revision = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    const r = await revision(...args); vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return r;
  });
  await expect(session.validate()).rejects.toThrow(/unavailable|changed/i);
});
test('provenance input reads are bounded and share one twenty-source cache across traces', async () => {
  const originals = await Promise.all(Array.from({ length: 24 }, (_, i) => source(`source-${i}`)));
  const reads = vi.spyOn(fs, 'readNote');
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  await session.trace(originals.slice(0, 12).map(s => s.path));
  const last = await session.trace(originals.slice(12).map(s => s.path));
  expect(reads.mock.calls.length).toBeLessThanOrEqual(20);
  expect(reads.mock.calls.every(c => c[1] === 8 * 1024 * 1024)).toBe(true);
  expect(last.unresolved).toBe(true);
});

test('a moderation-hidden parent is omitted even for an otherwise accessible path', async () => {
  const original = await source('hidden-study');
  const a = await source('a', { sourceDerivations: [edge(original)] });
  const raw = await readFile(join(root, original.path), 'utf8');
  await writeFile(join(root, original.path), raw.replace('immutable: true', 'immutable: true\nmoderation_status: hidden'));
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  const result = await session.trace([a.path]);
  expect(result.status).toBe('partial'); expect(result.unresolved).toBe(true);
  expect(JSON.stringify(result)).not.toContain('hidden-study');
  await expect(source('b', { sourceDerivations: [edge(original)] })).rejects.toThrow(/unavailable/i);
});

test('reader does not echo private ancestor identity or count on a malformed host-authored source', async () => {
  const original = await source('a');
  const raw = await readFile(join(root, original.path), 'utf8');
  await writeFile(join(root, original.path), raw.replace('immutable: true', `immutable: true\nsource_derivations:\n  - path: _scopes/agents/other/secret.md\n    revision: ${'a'.repeat(64)}\n    relation: quotation`));
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  const result = await session.trace([original.path]);
  expect(result.status).toBe('partial');
  expect(JSON.stringify(result)).not.toMatch(/secret|other|_scopes|hiddenCount|unavailableCount/);
});

test('bounded claim results retain ancestry warnings without truncating source revisions', async () => {
  const a = await source('a');
  await fs.writeNote({ path: 'Knowledge.md', content: 'Claim', frontmatter: { llm_wiki_type: 'knowledge', claims: [{ id: 'c1', text: 'Claim', evidence_paths: [a.path] }] } });
  const result = await wiki.claimMatrix(undefined, 'Knowledge.md', 20, 1024);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
  expect(result.revision).toHaveLength(64);
  expect(JSON.stringify(result)).toContain('source_ancestry_unresolved');
  expect(result.truncated).toBe(true);
});

test('retained original/YAML comment bytes count toward the request cache cap', async () => {
  const original = await source('original');
  const actual = await fs.readNote(original.path);
  vi.spyOn(fs, 'readNote').mockResolvedValue({ ...actual, originalContent: '#'.repeat(8 * 1024 * 1024), matter: '#'.repeat(8 * 1024 * 1024) });
  const session = new SourceProvenanceSession(fs, access, 'Knowledge.md');
  const result = await session.trace([original.path]);
  expect(result.truncated).toBe(true); expect(result.unresolved).toBe(true);
});

test('minimal path answer retains ancestry warnings at its smallest budget', async () => {
  const a = await source('a');
  await fs.writeNote({ path: 'Knowledge.md', content: 'Claim', frontmatter: { llm_wiki_type: 'knowledge', evidence_paths: [a.path], title: 'Long title '.repeat(40) } });
  const answer = await wiki.answerPacket(undefined, 'Knowledge.md', 1024, false, 'review');
  expect(JSON.stringify(answer).length).toBeLessThanOrEqual(1024);
  expect(JSON.stringify(answer)).toContain('source_ancestry_unresolved');
});
