import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { SourceChangeService } from './source-change.js';

let root: string, fs: FileSystemService, access: ScopeAccessPolicy, service: SourceChangeService;
const oldPath = '_sources/old.md', newPath = '_sources/new.md';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function note(path: string, body: string, fm: Record<string, unknown> = {}) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`);
}
async function source(path: string, body: string, extra: Record<string, unknown> = {}) {
  await note(path, body, { llm_wiki_type: 'source', immutable: true, content_sha256: hash(body), source_work_id: 'retry-spec', source_edition_id: path, ...extra });
}
async function pair() {
  await source(oldPath, '# Retry\n\nRetry any operation.\n');
  await source(newPath, '# Retry\n\nRetry only idempotent operations.\n');
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'wiki-source-change-')); fs = new FileSystemService(root); access = new ScopeAccessPolicy(); service = new SourceChangeService(fs, access); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

test('compares exact editions and maps an overlapping claim to a revision-pinned review draft without writes', async () => {
  await pair(); const oldRevision = await fs.readNoteRevision(oldPath);
  await note('Knowledge/Retry.md', '# Retry', { llm_wiki_type: 'knowledge', claims: [{ id: 'retry-all', text: 'Retry all operations', evidence: [{ path: oldPath, revision: oldRevision, startLine: 3, endLine: 3, quoteHash: hash('Retry any operation.') }] }] });
  const revision = await fs.readNoteRevision('Knowledge/Retry.md');
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(r.status).toBe('changed'); expect(r.delta.hunks[0].old.text).toContain('Retry any');
  expect(r.delta.hunks[0].new.text).toContain('only idempotent');
  expect(r.claims[0]).toMatchObject({ path: 'Knowledge/Retry.md', claimId: 'retry-all', impact: 'changed_locator_overlap', locatorState: 'current', revision });
  expect(r.claims[0].reviewDraft).toMatchObject({ endpointId: 'wiki.review_claim', arguments: { path: 'Knowledge/Retry.md', claimId: 'retry-all', expectedRevision: revision }, missingArguments: ['status', 'reviewedBy'] });
  expect(await fs.readNoteRevision('Knowledge/Retry.md')).toBe(revision);
  const oldNote = await fs.readNote(oldPath);
  const action = r.delta.hunks[0].old.readAction.arguments;
  expect(oldNote.originalContent.split('\n').slice(action.startLine - 1, action.endLine).join('\n')).toContain('Retry any operation.');
});
test('requires edition selection without guessing newest or trusting supersedes as authority', async () => {
  await pair(); await source('_sources/hidden.md', 'SECRET', { moderation_status: 'hidden' });
  await source('_scopes/agents/other/secret.md', 'PRIVATE');
  const r = await service.read({ sourcePath: newPath });
  expect(r.status).toBe('needs_selection'); expect(r.candidates.map((c: any) => c.path)).toEqual([oldPath]);
  expect(JSON.stringify(r)).not.toMatch(/SECRET|PRIVATE|hidden.md|secret.md/);
  expect(r.candidates[0].nextAction.arguments).toMatchObject({ sourcePath: newPath, previousSourcePath: oldPath, previousExpectedRevision: await fs.readNoteRevision(oldPath) });
});
test('different work identifiers and missing/private snapshots do not compare as a lineage', async () => {
  await pair(); await source('_sources/other.md', 'Other', { source_work_id: 'unrelated' });
  await expect(service.read({ sourcePath: newPath, previousSourcePath: '_sources/other.md' })).rejects.toThrow(/same work/);
  await expect(service.read({ sourcePath: newPath, previousSourcePath: '_sources/missing.md' })).rejects.toThrow(/unavailable/);
  await expect(service.read({ sourcePath: newPath, previousSourcePath: '_scopes/agents/other/private.md' })).rejects.toThrow(/unavailable/);
});
test.each(['_sources/new.md', '_sources/./new.md', '_SOURCES/NEW.MD'])('rejects self comparison through %s', async previousSourcePath => {
  await pair();
  await expect(service.read({ sourcePath: newPath, previousSourcePath })).rejects.toThrow(/distinct source/);
});
test('unchanged body is not an impact and stale citation revision is not a verified locator', async () => {
  await pair();
  await note('Knowledge/Stale.md', 'Body', { llm_wiki_type: 'knowledge', claims: [{ id: 'stale', text: 'x', evidence: [{ path: oldPath, revision: '0'.repeat(64), startLine: 3, endLine: 3 }] }] });
  let r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(r.claims[0].locatorState).toBe('stale_revision'); expect(r.claims[0].impact).toBe('source_reference_requires_review');
  await source(newPath, '# Retry\n\nRetry any operation.\n');
  r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(r.status).toBe('unchanged'); expect(r.delta.hunks).toEqual([]);
  expect(r.claims).toEqual([]);
});
test('note-level citations are not fabricated claims; review lifecycle does not mean refutation', async () => {
  await pair(); await note('Knowledge/Note.md', 'Body', { llm_wiki_type: 'knowledge', lifecycle: 'review', evidence_paths: [oldPath] });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(r.claims).toEqual([]); expect(r.noteReferences[0].role).toBe('note_level_citation');
  expect(JSON.stringify(r)).not.toMatch(/refuted/);
});
test.each(['edit', 'delete', 'revoke'] as const)('rejects %s during source reading without stale passages', async mode => {
  await pair(); const read = fs.readNote.bind(fs);
  vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => { const r = await read(...args); if (mode === 'edit') await source(newPath, 'CHANGED'); if (mode === 'delete') await rm(join(root, newPath)); if (mode === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false); return r; });
  await expect(service.read({ sourcePath: newPath, previousSourcePath: oldPath })).rejects.toThrow(/unavailable|changed/);
});
test('hash mismatch is review-needed, not silently repaired', async () => {
  await pair(); await source(newPath, 'Damaged', { content_sha256: '0'.repeat(64) });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(r.status).toBe('needs_source_review'); expect(r.current.integrity).toBe('mismatch');
});
test('out-of-range and heading-only locators are not certified by a matching revision', async () => {
  await pair(); const revision = await fs.readNoteRevision(oldPath);
  await note('Knowledge/Locators.md', 'Body', { llm_wiki_type: 'knowledge', claims: [
    { id: 'invalid', evidence: [{ path: oldPath, revision, startLine: 99999, endLine: 99999 }] },
    { id: 'heading', evidence: [{ path: oldPath, revision, heading: 'Never existed' }] },
  ] });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, maxChars: 12000 });
  expect(r.claims.find((c: any) => c.claimId === 'invalid').locatorState).toBe('invalid_range');
  expect(r.claims.find((c: any) => c.claimId === 'heading').locatorState).toBe('missing_heading');
});

test('claim locators share fence, containment and unique-block validation', async () => {
  await source(oldPath, '# Real\nvalue ^point\n~~~\n# Fake\nexample ^fake\n~~~\n# Other\nold\n');
  await source(newPath, '# Real\nvalue ^point\n~~~\n# Fake\nexample ^fake\n~~~\n# Other\nnew\n');
  const revision = await fs.readNoteRevision(oldPath);
  await note('Knowledge/Guards.md', 'Claim', { llm_wiki_type: 'knowledge', claims: [
    { id: 'fake', evidence: [{ path: oldPath, revision, heading: 'Fake', startLine: 4, endLine: 5 }] },
    { id: 'outside', evidence: [{ path: oldPath, revision, heading: 'Real', startLine: 8, endLine: 8 }] },
    { id: 'real', evidence: [{ path: oldPath, revision, heading: 'Other' }] },
  ] });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, knowledgePath: 'Knowledge/Guards.md', maxChars: 12000 });
  expect(r.claims.find((c: any) => c.claimId === 'fake')).toMatchObject({ locatorState: 'missing_heading', impact: 'source_reference_requires_review' });
  expect(r.claims.find((c: any) => c.claimId === 'outside')).toMatchObject({ locatorState: 'outside_heading', impact: 'source_reference_requires_review' });
  expect(r.claims.find((c: any) => c.claimId === 'real')).toMatchObject({ locatorState: 'current', impact: 'changed_locator_overlap' });
});
test('a second citation of the changed range is not hidden by the first unchanged citation', async () => {
  await pair(); const revision = await fs.readNoteRevision(oldPath);
  await note('Knowledge/Multiple.md', 'Body', { llm_wiki_type: 'knowledge', claims: [{ id: 'multi', evidence: [
    { path: oldPath, revision, startLine: 1, endLine: 1 }, { path: oldPath, revision, startLine: 3, endLine: 3 },
  ] }] });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, maxChars: 12000 });
  expect(r.claims[0].impact).toBe('changed_locator_overlap');
});
test('a selected note exceeding even the maximum budget leads to a bounded direct read, not a retry loop', async () => {
  await pair(); await note('Knowledge/Many.md', 'Body', { llm_wiki_type: 'knowledge', claims: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, evidence_paths: [oldPath] })) });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, knowledgePath: 'Knowledge/Many.md', maxChars: 12000 });
  expect(r.truncated).toBe(true); expect(r.nextAction.endpointId).not.toBe('wiki.source_lineage');
  expect(r.nextAction.arguments.expectedRevision).toBe(await fs.readNoteRevision('Knowledge/Many.md'));
});
test('discovery bypasses unrestricted query fallback and observes a bounded metadata page', async () => {
  await pair(); for (let i = 0; i < 75; i++) await note(`Misc/${i.toString().padStart(2, '0')}.md`, 'Unrelated');
  const query = vi.spyOn(fs, 'queryNotes'); const metadata = vi.spyOn(fs, 'readNoteMetadata');
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath });
  expect(query).not.toHaveBeenCalled(); expect(metadata.mock.calls.length).toBeLessThanOrEqual(62);
  expect(r.truncated).toBe(true); expect(r.nextAction.arguments.afterPath).toBeTruthy();
});
test('selection excludes mutable drafts and rejects object-valued work identities', async () => {
  await pair(); await source('_sources/draft.md', 'Draft', { immutable: false });
  expect((await service.read({ sourcePath: newPath })).candidates.map((n: any) => n.path)).toEqual([oldPath]);
  await source(oldPath, 'Old', { source_work_id: { id: 'alpha' } }); await source(newPath, 'New', { source_work_id: { id: 'beta' } });
  await expect(service.read({ sourcePath: newPath, previousSourcePath: oldPath })).rejects.toThrow(/same work/);
});
test.each(['HIDDEN-PATH', 'immutable source', 'same work', 'exceeds maxChars', 'metadata budget'])('final filesystem failures do not disclose a hidden path containing %s', async filename => {
  const hiddenPath = `Knowledge/${filename}.md`;
  await pair(); await note(hiddenPath, 'Hidden', { llm_wiki_type: 'knowledge', moderation_status: 'hidden' });
  const read = fs.readNoteRevision.bind(fs);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    if (args[0] === hiddenPath) throw Error(`ENOENT C:/vault/${hiddenPath}`);
    return read(...args);
  });
  await expect(service.read({ sourcePath: newPath, previousSourcePath: oldPath })).rejects.toThrow(/^Source comparison input unavailable/);
});
test('missing discovered metadata fails closed immediately instead of evading the scan budget', async () => {
  await pair(); for (let i = 0; i < 65; i++) await note(`Knowledge/Gone${i}.md`, 'Body', { llm_wiki_type: 'knowledge' });
  const read = fs.readNoteMetadata.bind(fs);
  const calls = vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => args[0][0].startsWith('Knowledge/') ? [] : read(...args));
  await expect(service.read({ sourcePath: newPath, previousSourcePath: oldPath })).rejects.toThrow(/unavailable/);
  expect(calls.mock.calls.length).toBeLessThanOrEqual(5);
});
test('first omitted note is read before cross-note continuation, including claim 31', async () => {
  await pair();
  for (const path of ['Knowledge/A.md', 'Knowledge/B.md']) await note(path, 'Body', { llm_wiki_type: 'knowledge', claims: Array.from({ length: 31 }, (_, i) => ({ id: `claim-${i}`, evidence_paths: i === 30 ? [oldPath] : [] })) });
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, maxChars: 4000 });
  expect(r.truncated).toBe(true); expect(r.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Knowledge/A.md' } });
  expect(r.scanContinuation.arguments.afterPath).toBe('Knowledge/A.md');
  const next = await service.read(r.scanContinuation.arguments);
  expect(next.nextAction.arguments.path).toBe('Knowledge/B.md');
});
test('a first selection item omitted for budget retries before advancing the scan', async () => {
  const prefix = `_sources/${'a'.repeat(90)}/${'b'.repeat(90)}/${'c'.repeat(90)}/${'d'.repeat(90)}`;
  const target = `${prefix}/new.md`;
  await source(target, 'new');
  for (let i = 0; i < 20; i++) await source(`${prefix}/old${i}.md`, 'old');
  const r = await service.read({ sourcePath: target, maxChars: 2000 });
  expect(r.truncated).toBe(true); expect(r.candidates || []).toEqual([]);
  expect(r.nextAction?.arguments.afterPath).toBeUndefined();
  expect(r.nextAction?.arguments.maxChars || r.retryArguments.maxChars).toBe(12000);
});
test('whole JSON respects budget, private claims are omitted and body loads are bounded', async () => {
  await pair();
  for (let i = 0; i < 25; i++) await note(`Knowledge/K${i.toString().padStart(2, '0')}.md`, 'Body', { llm_wiki_type: 'knowledge', claims: [{ id: `c${i}`, text: 'x'.repeat(350), evidence_paths: [oldPath] }] });
  await note('_scopes/agents/other/PRIVATE.md', 'PRIVATE', { llm_wiki_type: 'knowledge', evidence_paths: [oldPath] });
  const reads = vi.spyOn(fs, 'readNote');
  const r = await service.read({ sourcePath: newPath, previousSourcePath: oldPath, maxChars: 2000, prettyPrint: true });
  expect(JSON.stringify(r, null, 2).length).toBeLessThanOrEqual(2000); expect(r.truncated).toBe(true);
  expect(JSON.stringify(r)).not.toContain('PRIVATE'); expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
  expect(r.nextAction || r.retryArguments).toBeTruthy();
});
