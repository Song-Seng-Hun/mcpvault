import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { buildGraphAssertionPacket } from './graph-assertion-packet.js';
let root: string, fs: FileSystemService, access: ScopeAccessPolicy;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'assertions-')); fs = new FileSystemService(root); access = new ScopeAccessPolicy(); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const packet = (options = {}) => buildGraphAssertionPacket(fs, access, undefined, { path: 'A.md', maxChars: 16000, ...options });
async function seed() {
  await fs.writeNote({ path: 'A.md', content: '[[B.md]] [[B.md]]', frontmatter: { supports: ['B.md'], contradicts: ['B.md'] } });
  await fs.writeNote({ path: 'B.md', content: '# 근거\nFact 😀 ^proof' });
}
test('occurrences preserve kind, direction and both revisions without raw authored labels', async () => {
  await seed(); const r = await packet();
  expect(r.assertions.map(a => a.relation)).toEqual(['supports', 'contradicts', 'link', 'link']);
  expect(new Set(r.assertions.map(a => a.id)).size).toBe(4);
  expect(r.assertions.every(a => a.source.revision.length === 64 && a.target.revision.length === 64 && a.evidenceState === 'not_verified')).toBe(true);
  expect(JSON.stringify(r)).not.toContain('targetReference');
  expect(r.coverage.globalIntegrity).toBe(false);
});
test('missing and hidden targets produce identical bounded public output', async () => {
  await seed(); await fs.writeNote({ path: 'A.md', content: '[[Secret.md|secret title]]' });
  const missing = await packet();
  await fs.writeNote({ path: 'Secret.md', content: 'secret body' });
  const allowed = access.canAccessPhysicalPath.bind(access);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((p, u) => p !== 'Secret.md' && allowed(p, u));
  expect(await packet()).toEqual(missing);
  expect(JSON.stringify(missing)).not.toMatch(/Secret|secret title|secret body/);
});
test('claim identity follows shared normalization and validates source/target anchors', async () => {
  await seed(); await fs.writeNote({ path: 'A.md', content: 'Source ^foo-bar', frontmatter: { claims: [{ id: 'Foo Bar', text: 'Source', supports_claims: ['[[B.md#^proof]]'] }] } });
  const r = await packet();
  expect(r.assertions[0]).toMatchObject({ source: { claimId: 'foo-bar' }, target: { blockId: 'proof' }, validation: { state: 'current_locators' } });
});
test('duplicate source claim identities and missing target anchors remain review, not verified', async () => {
  await seed(); await fs.writeNote({ path: 'A.md', content: 'Source ^x', frontmatter: { claims: [{ id: 'X', text: 'One', supports_claims: ['[[B.md#^absent]]'] }, { id: 'x', text: 'Two' }] } });
  const r = await packet();
  expect(r.assertions[0]!.validation.state).toBe('review_required');
  expect(r.assertions[0]!.validation.reasons).toContain('source_claim_not_unique');
  expect(r.assertions[0]!.validation.reasons).toContain('target_anchor_unavailable');
});
test.each(['source', 'target', 'revoke', 'delete'])('final revalidation discards %s drift', async kind => {
  await seed(); const read = fs.readNoteRevision.bind(fs); let changed = false;
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => {
    if (!changed) { changed = true;
      if (kind === 'revoke') vi.spyOn(access, 'canAccessPhysicalPath').mockReturnValue(false);
      else if (kind === 'delete') await rm(join(root, 'B.md'));
      else await fs.writeNote({ path: kind === 'source' ? 'A.md' : 'B.md', content: 'changed' });
    }
    return read(...args);
  });
  await expect(packet()).rejects.toThrow('Graph context unavailable or changed');
});
test('fresh resolver detects a new alias collision before release', async () => {
  await seed(); await fs.writeNote({ path: 'A.md', content: '[[Alias]]' });
  await fs.writeNote({ path: 'B.md', content: 'B', frontmatter: { aliases: ['Alias'] } });
  const resolve = fs.createNoteReferenceResolver.bind(fs); let calls = 0;
  vi.spyOn(fs, 'createNoteReferenceResolver').mockImplementation((...args) => {
    const resolver = resolve(...args);
    return async (...params) => {
      if (++calls === 2) await fs.writeNote({ path: 'New.md', content: 'C', frontmatter: { aliases: ['Alias'] } });
      return resolver(...params);
    };
  });
  await expect(packet()).rejects.toThrow('Graph context unavailable or changed');
});
test.each([512, 1500, 4000])('formatted response fits %i chars with exact root read when partial', async maxChars => {
  await seed(); const r = await packet({ maxChars, prettyPrint: true });
  expect(JSON.stringify(r, null, 2).length).toBeLessThanOrEqual(maxChars);
  if (r.partial) expect(r.nextAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'A.md', expectedRevision: await fs.readNoteRevision('A.md') } });
});
test('metadata and body admissions are bounded, fenced examples excluded', async () => {
  await seed(); await fs.writeNote({ path: 'A.md', content: '~~~\n[[HiddenExample]]\n~~~\n[[UnknownAlias]]' });
  for (let i = 0; i < 70; i++) await fs.writeNote({ path: `Z${i}.md`, content: 'note' });
  const read = vi.spyOn(fs, 'readNoteMetadata'), body = vi.spyOn(fs, 'readNote');
  const r = await packet(); expect(r.partial).toBe(true);
  expect(read.mock.calls.flatMap(c => c[0]).length).toBeLessThanOrEqual(64);
  expect(body.mock.calls.length).toBeLessThanOrEqual(8);
  expect(JSON.stringify(r)).not.toContain('HiddenExample');
});
