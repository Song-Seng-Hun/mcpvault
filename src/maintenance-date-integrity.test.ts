import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ReferenceService } from './references.js';
import { LlmWikiService } from './llm-wiki.js';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from './createServer.js';

let vault: string, wiki: LlmWikiService;
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'mcpvault-maintenance-dates-'));
  const fs = new FileSystemService(vault), access = new ScopeAccessPolicy();
  wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
});
afterEach(async () => {
  const base = await realpath(tmpdir()), target = await realpath(vault), path = relative(base, target);
  if (!path || path.startsWith('..') || isAbsolute(path) || !basename(target).startsWith('mcpvault-maintenance-dates-')) throw new Error('Unsafe fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
async function seed(fields: Record<string, unknown>, path = 'Note.md', body = '# Current\n\n[[Missing evidence]]') {
  const raw = `---\n${stringify({ llm_wiki_type: 'knowledge', note_kind: 'question', epistemic_status: 'open', lifecycle: 'evergreen', updated_at: '2000-01-01', ...fields })}---\n${body}`;
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), raw);
  return raw;
}
const invalidPast = ['2024-02-30', ['2000-01-01'], null, '', 'January 1, 2000'];
const invalidFuture = ['2999-02-30', ['2999-01-01'], null, '', 'January 1, 2999'];

test.each(invalidFuture.map(value => [value]))('malformed snooze %j cannot suppress gaps, unused notes or review priorities', async review_snoozed_until => {
  const raw = await seed({ review_snoozed_until });
  const gaps: any = await wiki.knowledgeGaps(undefined, 10, 12000);
  expect.soft(gaps.total).toBe(1);
  expect.soft(gaps.items[0]?.reasons || []).toContain('invalid_review_snoozed_until');
  expect.soft((await wiki.unusedKnowledge(undefined, 30, 10, 12000)).total).toBe(1);
  const packet: any = await wiki.reviewPacket(undefined, 10, 16000);
  expect.soft(packet.counts.snoozedPriorities).toBe(0);
  expect.soft(packet.nextSnoozedReviewAt).toBeUndefined();
  expect.soft(packet.priorities.map((item: any) => item.path)).toContain('Note.md');
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
});

test.each(invalidPast.map(value => [value]))('invalid review date %j is a repair reason, not overdue impact', async review_at => {
  const raw = await seed({ review_at });
  const report: any = await wiki.impactReport(undefined, 10, 12000);
  expect(report.total).toBe(1);
  expect(report.items[0].reasons).toContain('invalid_review_at');
  expect(report.items[0].reasons).not.toContain('review_due');
  expect(report.items[0].reviewAt).toBeUndefined();
  expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
});

test.each(invalidPast.map(value => [value]))('invalid modified date %j does not invent an unused age or fall back to creation', async updated_at => {
  await seed({ updated_at, created_at: '2000-01-01' });
  expect((await wiki.unusedKnowledge(undefined, 30, 10, 12000)).total).toBe(0);
});

for (const field of ['retention_at', 'preserve_until']) {
  test.each(invalidPast.map(value => [value]))(`invalid ${field} %j preserves the note pending metadata repair`, async value => {
    const raw = await seed({ retention_policy: 'archive', retention_at: '2000-01-01', [field]: value });
    const result: any = await wiki.retentionQueue(undefined, 10, 12000);
    expect(result.total).toBe(1);
    expect(result.items[0].reasons).toContain(`invalid_${field}`);
    expect(result.items[0].suggestedAction).toBe('preserve_and_review_metadata');
    if (field === 'retention_at') {
      expect(result.items[0].reasons).not.toContain('retention_review_due');
      expect(result.items[0].retentionAt).toBeUndefined();
    }
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  });
}

test('malformed preservation alone remains discoverable without an existing retention policy', async () => {
  await seed({ preserve_until: ['2999-01-01'] });
  const result: any = await wiki.retentionQueue(undefined, 10, 12000);
  expect(result.total).toBe(1);
  expect(result.items[0].reasons).toContain('invalid_preserve_until');
  expect(result.items[0].suggestedAction).toBe('preserve_and_review_metadata');
});

test.each(invalidPast.map(value => [value]))('invalid recall date %j is not evidence of elapsed recall time', async last_recalled_at => {
  await seed({ note_kind: 'atomic', recall_prompt: 'Explain the mechanism', recall_interval_days: 1, last_recalled_at });
  const result: any = await wiki.knowledgeGaps(undefined, 10, 12000);
  expect(result.total).toBe(1);
  expect(result.items[0].reasons).toContain('invalid_last_recalled_at');
  expect(result.items[0].reasons).not.toContain('recall_due');
  expect(result.items[0].suggestedAction).toMatch(/repair.*date/i);
});

test.each([...invalidPast, '2999-02-30'].map(value => [value]))('recall queue and review packet route invalid history %j to repair, not elapsed recall', async last_recalled_at => {
  await seed({ note_kind: 'atomic', recall_prompt: 'Explain the mechanism', recall_interval_days: 1, last_recalled_at }, 'Note.md', '# Current');
  const recall: any = await wiki.recallQueue(undefined, 10, 12000);
  expect.soft(recall.total).toBe(1);
  expect.soft(recall.items[0]?.reason).toBe('invalid_last_recalled_at');
  expect.soft(recall.items[0]?.ageDays).toBeUndefined();
  expect.soft(recall.items[0]?.nextRecallAt).toBeUndefined();
  expect.soft(recall.items[0]?.dateRepairAction).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Note.md' } });
  const packet: any = await wiki.reviewPacket(undefined, 10, 16000);
  const priority = packet.priorities.find((item: any) => item.path === 'Note.md');
  expect.soft(priority?.reasons).toContain('invalid_last_recalled_at');
  expect.soft(priority?.reasons).not.toContain('active_recall_due');
  expect.soft(packet.curationPlan?.selected.reason).toBe('invalid_last_recalled_at');
  expect.soft(packet.curationPlan?.inspect).toMatchObject({ endpointId: 'notes.read', arguments: { path: 'Note.md' } });
  expect.soft(packet.curationPlan?.then.endpointId).not.toBe('wiki.record_recall');
});

test('unseen recall history has no invented age', async () => {
  await seed({ note_kind: 'atomic', recall_prompt: 'Explain', recall_interval_days: 1 });
  const recall: any = await wiki.recallQueue();
  expect(recall.items[0].reason).toBe('never_recalled');
  expect(recall.items[0].ageDays).toBeUndefined();
});

test('private recall date repair targets its own record revision, not the shared knowledge note', async () => {
  const principal = { accountId: 'reader', modelId: 'codex', agentId: 'date-worker', role: 'agent' as const };
  await seed({ note_kind: 'atomic', recall_prompt: 'Explain', recall_interval_days: 1, last_recalled_at: '2999-01-01' });
  const digest = createHash('sha256').update('note.md').digest('hex');
  const privatePath = `_scopes/agents/date-worker/_continuity/recall/${digest}.md`;
  const privateRaw = await seed({ llm_wiki_type: 'agent_state', owner: 'date-worker', last_recalled_at: null, recall_interval_days: 1 }, privatePath);
  await seed({ llm_wiki_type: 'agent_state', last_recalled_at: 'bad', title: 'OTHER-PRIVATE-STATE' }, `_scopes/agents/other/_continuity/recall/${digest}.md`);
  const publicPath = new ScopeAccessPolicy().toPublicPath(privatePath);
  const recall: any = await wiki.recallQueue(principal, 10, 12000);
  expect(recall.items[0].reason).toBe('invalid_last_recalled_at');
  expect(recall.items[0].dateRepairAction.arguments.path).toBe(publicPath);
  const packet: any = await wiki.reviewPacket(principal, 10, 16000);
  expect(packet.curationPlan.inspect.arguments.path).toBe(publicPath);
  expect(packet.curationPlan.then.arguments).toMatchObject({ path: publicPath,
    expectedRevision: createHash('sha256').update(privateRaw).digest('hex'), dryRun: true });
  expect(JSON.stringify(packet)).not.toContain('OTHER-PRIVATE-STATE');
  expect(await readFile(join(vault, privatePath), 'utf8')).toBe(privateRaw);
});

test('valid snooze, date offsets, retention holds and missing recall history keep their meaning', async () => {
  await seed({ review_snoozed_until: '2999-01-01T00:00:00+09:00' });
  expect((await wiki.knowledgeGaps()).total).toBe(0);
  expect((await wiki.unusedKnowledge()).total).toBe(0);
  const packet: any = await wiki.reviewPacket(undefined, 10, 16000);
  expect(packet.priorities).toEqual([]);
  expect(packet.nextSnoozedReviewAt).toBe('2998-12-31T15:00:00.000Z');
  await seed({ review_at: '2000-02-29T23:00:00-08:00', retention_policy: 'archive', retention_at: '2000-02-29', preserve_until: '2999-01-01' });
  expect((await wiki.impactReport()).items[0]!.reasons).toContain('review_due');
  const retained: any = await wiki.retentionQueue();
  expect(retained.items[0].suggestedAction).toBe('preserve_and_review_metadata');
  await seed({ note_kind: 'atomic', recall_prompt: 'Explain the mechanism', recall_interval_days: 1 });
  expect((await wiki.knowledgeGaps()).items[0]!.reasons).toContain('recall_due');
});

test('hidden and other-scope dates do not contribute to knowledge gap repair counts', async () => {
  await seed({ review_snoozed_until: 'bad', moderation_status: 'hidden', recall_prompt: 'HIDDEN-PROMPT', last_recalled_at: 'bad' });
  await seed({ review_at: 'bad' }, '_scopes/models/other/Secret.md');
  expect((await wiki.knowledgeGaps()).total).toBe(0);
  expect((await wiki.recallQueue()).total).toBe(0);
});

test('actual MCP maintenance reads keep bounded responses and never rewrite malformed metadata', async () => {
  const raw = await seed({ review_snoozed_until: ['2999-01-01'], review_at: '2024-02-30',
    retention_policy: 'archive', preserve_until: '2024-02-30', recall_prompt: 'Explain',
    recall_interval_days: 1, last_recalled_at: '2024-02-30' });
  const server = createServer(vault, { version: 'maintenance-date-test' });
  const client = new Client({ name: 'maintenance-date-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    expect((await client.listTools()).tools).toHaveLength(5);
    for (const endpointId of ['wiki.knowledge_gaps', 'wiki.review_packet', 'wiki.impact_report', 'wiki.unused_knowledge', 'wiki.retention_queue', 'wiki.recall_queue']) {
      for (const maxChars of [512, 1024, 12000]) {
        const result = await client.callTool({ name: 'call_endpoint', arguments: { endpointId, arguments: { maxChars, prettyPrint: true } } });
        expect(result.isError, endpointId).not.toBe(true);
        const text = (result.content as any)[0].text as string;
        expect(text.length, endpointId).toBeLessThanOrEqual(maxChars);
        const packet = JSON.parse(text);
        if (maxChars === 12000) {
          if (endpointId === 'wiki.review_packet') expect(packet.counts.snoozedPriorities).toBe(0);
          else expect(packet.total).toBe(1);
        }
      }
    }
    expect(await readFile(join(vault, 'Note.md'), 'utf8')).toBe(raw);
  } finally { await client.close(); await server.close(); }
});
