import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';

let vault: string;
let fs: FileSystemService;
let service: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-retention-resurface-'));
  fs = new FileSystemService(vault);
  const access = new ScopeAccessPolicy();
  service = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function seed(path: string, fields = '', body = 'Current durable knowledge.') {
  const raw = `---\nllm_wiki_type: knowledge\nretention_policy: review\nretention_at: 2020-01-01\n${fields}\n---\n${body}`;
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  return raw;
}
const kinds = ['retention', 'resurface'] as const;
const report = (kind: typeof kinds[number], maxChars = 5000) => kind === 'retention'
  ? service.retentionQueue(undefined, 10, maxChars)
  : service.resurfaceKnowledge(undefined, 10, maxChars, 'context '.repeat(120));

test.each(kinds)('%s excludes hidden and foreign scope notes before counting', async kind => {
  await seed('Visible.md');
  for (const state of ['hidden', 'removed', 'quarantined']) await seed(`${state}.md`, `moderation_status: ${state}`);
  await seed('_scopes/agents/other/Secret.md');
  const result = await report(kind);
  expect(result.total).toBe(1);
  expect(result.items).toEqual([expect.objectContaining({ path: 'Visible.md' })]);
  expect(JSON.stringify(result)).not.toMatch(/hidden\.md|removed\.md|quarantined\.md|Secret/);
});

test.each(kinds)('%s bounds the whole report and preserves an exact revision-bearing read', async kind => {
  const raw = await seed('Long.md', `title: ${'Long title '.repeat(200)}\nretention_reason: ${'Reason '.repeat(100)}\nretrieval_cues: [${'Cue'.repeat(1000)}]\nuse_when: ${'When '.repeat(300)}`);
  for (const maxChars of [512, 600, 900, 1400, 5000]) {
    const result: any = await report(kind, maxChars);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxChars);
    expect(result.items[0]).toMatchObject({ path: 'Long.md', revision: createHash('sha256').update(raw).digest('hex'),
      nextAction: { endpointId: 'notes.read', arguments: { path: 'Long.md', maxChars: 3000 } } });
  }
  expect(await readFile(join(vault, 'Long.md'), 'utf8')).toBe(raw);
});

test.each(kinds)('%s rechecks metadata changed after discovery', async kind => {
  await seed('Racing.md');
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementation(async (...args) => {
    const result = await query(...args);
    await seed('Racing.md', 'moderation_status: hidden');
    return result;
  });
  expect(await report(kind)).toMatchObject({ items: [], total: 0 });
});

test('retention keeps legal hold and preserve-until ahead of disposition advice', async () => {
  await seed('Hold.md', 'legal_hold: true');
  await seed('Preserve.md', 'preserve_until: 2099-01-01');
  const result: any = await report('retention');
  expect(result.items).toHaveLength(2);
  for (const item of result.items) expect(item).toMatchObject({ suggestedAction: 'preserve_and_review_metadata', revision: expect.any(String) });
});

test('retention resolves visible replacement links without exposing private or hidden targets', async () => {
  await seed('A.md', 'replaced_by: "[[_scopes/agents/other/Secret]]"');
  await seed('B.md', 'replaced_by: "[[Hidden]]"');
  await seed('C.md', 'replaced_by: "[[New]]"');
  await seed('Hidden.md', 'moderation_status: hidden');
  await seed('_scopes/agents/other/Secret.md');
  await writeFile(join(vault, 'New.md'), '# New');
  const result: any = await report('retention', 16000);
  expect(JSON.stringify(result)).not.toMatch(/Secret|Hidden/);
  expect(result.items.find((item: any) => item.path === 'C.md')).toMatchObject({ replacedBy: 'New.md', replacementRevision: expect.any(String) });
});

test('resurface marks obsolete summaries stale and provides current-body context', async () => {
  await seed('Stale.md', `summary: Obsolete dangerous advice\nsummary_of_content_sha256: ${'0'.repeat(64)}`, '# Current\n\nCorrected explanation.');
  const result: any = await report('resurface');
  expect(result.items[0]).toMatchObject({ summaryFresh: false, excerpt: expect.stringContaining('Corrected explanation.') });
  expect(JSON.stringify(result)).not.toContain('Obsolete dangerous advice');
});

test('resurface verifies fresh summaries against the selected current body', async () => {
  await seed('Fresh.md');
  const note = await fs.readNote('Fresh.md');
  await seed('Fresh.md', `summary: Verified compact context\nsummary_of_content_sha256: ${createHash('sha256').update(note.content).digest('hex')}`);
  const result: any = await report('resurface');
  expect(result.items[0]).toMatchObject({ summary: 'Verified compact context', summaryFresh: true });
});

test('empty resurface report remains bounded with a long original context', async () => {
  const result: any = await report('resurface', 512);
  expect(result.items).toEqual([]);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
});

test('resurface body checks cover only selected candidates and do not mutate notes', async () => {
  for (let i = 0; i < 12; i++) await seed(`${i}.md`);
  const read = vi.spyOn(fs, 'readNote');
  const result: any = await service.resurfaceKnowledge(undefined, 2, 6000);
  expect(result.items).toHaveLength(2);
  expect(read).toHaveBeenCalledTimes(2);
});

test('tiny resurface retries preserve a long ranking context instead of silently changing it', async () => {
  const path = Array.from({ length: 7 }, (_, i) => `${i}-${'long-name'.repeat(5)}`).join('/') + '/Note.md';
  await seed(path);
  const context = 'problem '.repeat(120);
  const result: any = await service.resurfaceKnowledge(undefined, 1, 512, context);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result).toMatchObject({ items: [], total: 1, retry: { endpointId: 'wiki.resurface', reuseOriginalArguments: true, overrides: { limit: 1, maxChars: 12000 } } });
  const expanded: any = await service.resurfaceKnowledge(undefined, result.retry.overrides.limit, result.retry.overrides.maxChars, context);
  expect(expanded.items[0].path).toBe(path);
  expect(expanded.context).toBe(context.trim());
});

test('retention retry arguments never include presentation metadata', async () => {
  const path = Array.from({ length: 7 }, (_, i) => `${i}-${'long-name'.repeat(5)}`).join('/') + '/Note.md';
  await seed(path);
  const result: any = await service.retentionQueue(undefined, 1, 512);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(512);
  expect(result.nextAction).toEqual({ endpointId: 'wiki.retention_queue', arguments: { limit: 1, maxChars: 16000 } });
});

test.each(kinds)('%s omits a candidate whose revision changes during the final check', async kind => {
  await seed('Changed.md');
  const read = fs.readNoteMetadata.bind(fs);
  let reads = 0;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    if (++reads === 2) await seed('Changed.md', 'legal_hold: true', 'Changed after ranking.');
    return read(...args);
  });
  expect(await report(kind)).toMatchObject({ items: [], total: 0 });
});

test('retention replacement reads preserve authorized scope URIs', async () => {
  const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await seed('_scopes/agents/worker/Old.md', 'replaced_by: "[[scope://agent/worker/New.md]]"');
  await seed('_scopes/agents/worker/New.md');
  const result: any = await service.retentionQueue(principal, 10, 6000);
  expect(result.items.find((item: any) => item.path === 'scope://agent/worker/Old.md')).toMatchObject({ replacedBy: 'scope://agent/worker/New.md', replacementRevision: expect.any(String) });
});

test('retention filters hidden and non-referenceable alias matches before testing uniqueness', async () => {
  const principal = { accountId: 'worker', modelId: 'codex', agentId: 'worker', role: 'agent' as const };
  await seed('Old.md', 'replaced_by: "[[Replacement alias]]"');
  await seed('Visible.md', 'aliases: [Replacement alias]');
  await seed('Hidden.md', 'aliases: [Replacement alias]\nmoderation_status: hidden');
  await seed('_scopes/agents/worker/Private.md', 'aliases: [Replacement alias]');
  const result: any = await service.retentionQueue(principal, 10, 16000);
  expect(result.items.find((item: any) => item.path === 'Old.md')).toMatchObject({ replacedBy: 'Visible.md', replacementRevision: expect.any(String) });
});

test.each(['hidden', 'edited', 'deleted'])('retention revalidates a replacement %s after its initial resolution', async change => {
  await seed('Old.md', 'replaced_by: "[[Replacement]]"');
  await writeFile(join(vault, 'Replacement.md'), '# Replacement');
  const read = fs.readNoteMetadata.bind(fs);
  let resolved = false;
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async (...args) => {
    const result = await read(...args);
    if (args[0].includes('Replacement.md') && !resolved) {
      resolved = true;
      if (change === 'deleted') await rm(join(vault, 'Replacement.md'));
      else await writeFile(join(vault, 'Replacement.md'), change === 'hidden' ? '---\nmoderation_status: hidden\n---\nHidden' : '# Edited replacement');
    }
    return result;
  });
  const result: any = await service.retentionQueue(undefined, 10, 5000);
  expect(result.items[0]).toMatchObject({ path: 'Old.md', replacementState: 'unavailable' });
  expect(result.items[0]).not.toHaveProperty('replacedBy');
  expect(result.items[0]).not.toHaveProperty('replacementRevision');
});
