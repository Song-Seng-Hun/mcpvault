import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { PathFilter } from './pathfilter.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { DocumentResourceReader } from './document-resource.js';
import { DocumentIndex } from './document-index.js';
import { DocumentService } from './document-service.js';
import { pdfDocumentStructure } from './document-pdf.js';
let root: string, service: DocumentService;
const principal = { accountId: 'alice', modelId: 'gpt', agentId: 'alice-worker', role: 'agent' as const, sessionId: 'session-one' };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcpvault-document-service-'));
  service = new DocumentService(new DocumentIndex(new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy())));
});
afterEach(async () => { service.index.close(); await rm(root, { recursive: true, force: true }); });

test('PDF service preserves page boxes and original revision while enforcing source freshness', async () => {
  await writeFile(join(root, 'paper.pdf'), '%PDF-1.7\nfixture');
  service.index.close();
  let revision = '';
  service = new DocumentService(new DocumentIndex(new DocumentResourceReader(new FileSystemService(root), new PathFilter(), new ScopeAccessPolicy()), undefined, {
    pdf: { extract: async snapshot => {
      revision = snapshot.revision;
      return pdfDocumentStructure(snapshot.path, snapshot.revision, { version: 1, sourceSha256: snapshot.revision,
        profile: `mcpvault-pdf-v1:${'b'.repeat(64)}`, gaps: [], metrics: { totalPages: 1 }, pages: [{ page: 1, text: 'Never run without approval.', status: 'ok', gaps: [],
          regions: [{ startOffset: 0, endOffset: 27, bbox: [1, 2, 40, 60] }] }] });
    } },
  }));
  const result = await service.read({ path: 'paper.pdf', maxChars: 2000 });
  expect(result.revision).toBe(revision);
  expect(result.locator).toContain('extracted');
  expect(result.parts[0]?.pdfProvenance?.[0]?.page).toBe(1);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  await writeFile(join(root, 'paper.pdf'), '%PDF-1.7\nchanged');
  await expect(service.read({ path: 'paper.pdf', expectedRevision: revision })).rejects.toThrow(/Stale/);
});

test('outline is bounded, revision-pinned, resumable and includes long-document tails', async () => {
  await writeFile(join(root, 'note.md'), '# Topic\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.`).join('\n\n'));
  let result = await service.outline({ path: 'note.md', maxChars: 1800, limit: 3 });
  const revision = result.revision, items = [...result.items];
  while (result.cursor) {
    result = await service.outline({ path: 'note.md', expectedRevision: revision, cursor: result.cursor, maxChars: 1800, limit: 3 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1800); items.push(...result.items);
  }
  expect(items.some(i => i.description.includes('Paragraph 79'))).toBe(true);
});

test('a complete exact response may fit even when a continuation envelope would not', async () => {
  await writeFile(join(root, 'n.md'), 'hello');
  const result = await service.read({ path: 'n.md', startOffset: 0, endOffset: 5, mode: 'exact', maxChars: 512 });
  expect(result.parts[0]?.text).toBe('hello');
  expect(result.nextAction).toBeUndefined();
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});

test('exact line read preserves CRLF locators and semantic read retains table headers', async () => {
  const raw = '# Counts\r\n\r\n| Name | Count |\r\n| --- | --- |\r\n| A | 3 |\r\n';
  await writeFile(join(root, 'note.md'), raw);
  const exact = await service.read({ path: 'note.md', startLine: 5, endLine: 5, mode: 'exact' });
  expect(exact.parts.map((p: any) => p.text).join('')).toBe('| A | 3 |');
  for (const part of exact.parts) expect(raw.slice(part.startOffset, part.endOffset)).toBe(part.text);
  const semantic = await service.read({ path: 'note.md', startLine: 5, endLine: 5 });
  expect(semantic.parts.some((p: any) => p.role === 'table_header' && p.text.includes('| --- |'))).toBe(true);
});

test('bounded continuation exhausts a giant line without surrogate splits or omissions', async () => {
  const raw = '한😀글'.repeat(1200); await writeFile(join(root, 'note.md'), raw);
  let result = await service.read({ path: 'note.md', startOffset: 0, endOffset: raw.length, mode: 'exact', maxChars: 1700 });
  let collected = '', count = 0;
  for (;;) {
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1700);
    collected += result.parts.map((p: any) => p.text).join(''); count++;
    if (!result.nextAction) break;
    expect(count).toBeLessThan(40);
    result = await service.read(result.nextAction.arguments);
  }
  expect(collected).toBe(raw);
});

test('receipt deduplication is caller/session/revision bound and explicit rereads work', async () => {
  await writeFile(join(root, 'note.md'), '# A\n\nHello world.');
  const args = { path: 'note.md', startLine: 3, mode: 'exact' as const, principal };
  const first = await service.read(args);
  const knownReads = first.parts.map((p: any) => p.receipt);
  expect(knownReads.every(Boolean)).toBe(true);
  const duplicate = await service.read({ ...args, knownReads });
  expect(duplicate.parts).toEqual([]); expect(duplicate.skippedRanges).toBe(1);
  expect((await service.read({ ...args, knownReads, forceRead: true })).parts[0]!.text).toBe('Hello world.');
  await expect(service.read({ ...args, knownReads, principal: { ...principal, sessionId: 'other' } })).rejects.toThrow(/receipt/i);
  await writeFile(join(root, 'note.md'), '# A\n\nChanged world.');
  await expect(service.read({ ...args, knownReads })).rejects.toThrow(/receipt/i);
});

test('stale fragments/cursors fail closed and batched ranges remain precise', async () => {
  await writeFile(join(root, 'note.md'), '# A\n\none\n\ntwo');
  const outline = await service.outline({ path: 'note.md', limit: 1 });
  await expect(service.read({ path: 'note.md', fragmentId: outline.items[0]!.id })).rejects.toThrow(/revision/i);
  const read = await service.read({ path: 'note.md', ranges: [{ startLine: 3, mode: 'exact' }, { startLine: 5, mode: 'exact' }] });
  expect(read.parts.map((p: any) => p.text)).toEqual(['one', 'two']);
  await writeFile(join(root, 'note.md'), '# B\nnew');
  await expect(service.outline({ path: 'note.md', expectedRevision: outline.revision, cursor: outline.cursor! })).rejects.toThrow(/revision|stale/i);
});

test('raw exports reassemble original binary and invalid-UTF8 script bytes without executing', async () => {
  const bytes = Buffer.from([0xff, 0xfe, 0, 99, 42, 27]); await writeFile(join(root, 'script.sh'), bytes);
  const manifest = await service.manifest({ path: 'script.sh' });
  expect(manifest.byteLength).toBe(bytes.length); expect(manifest.execution).toBe('never');
  let result = await service.export({ path: 'script.sh', byteLength: 2 });
  const parts = [];
  for (;;) { parts.push(Buffer.from(result.data, 'base64')); if (!result.nextAction) break; result = await service.export(result.nextAction.arguments); }
  expect(Buffer.concat(parts)).toEqual(bytes);
});

test('all services retain moderation, scope denial and input/response bounds', async () => {
  await writeFile(join(root, 'hidden.md'), '---\nmoderation_status: hidden\n---\nsecret');
  for (const method of ['outline', 'read', 'manifest', 'export'] as const) await expect(service[method]({ path: 'hidden.md' })).rejects.toThrow();
  await writeFile(join(root, 'note.md'), 'hello');
  await expect(service.read({ path: 'note.md', ranges: Array(9).fill({ startLine: 1 }) })).rejects.toThrow(/ranges|eight|8/i);
  await expect(service.read({ path: 'note.md', maxChars: 1 })).rejects.toThrow(/budget|maxChars|envelope/i);
  const result = await service.read({ path: 'note.md' });
  expect(JSON.stringify(result)).not.toContain(root);
});
test('empty range batches never bypass complete JSON envelope admission', async () => {
  await writeFile(join(root, 'note.md'), 'hello');
  const result = await service.read({ path: 'note.md', ranges: Array(8).fill({ startOffset: 0, endOffset: 0, mode: 'exact' }), maxChars: 1000 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
  expect(result.parts).toEqual([]);
});
