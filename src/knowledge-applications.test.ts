import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { KnowledgeApplicationService } from './knowledge-applications.js';
import { LlmWikiService } from './llm-wiki.js';
import { ReferenceService } from './references.js';
import { AgentTaskService } from './agent-tasks.js';
import { ScopeAuthService, type ScopePrincipal } from './scope-auth.js';
import { VaultMetadataIndex } from './vault-index.js';
import { FrontmatterHandler } from './frontmatter.js';
import { PathFilter } from './pathfilter.js';

let vault: string, fs: FileSystemService, access: ScopeAccessPolicy, service: KnowledgeApplicationService;
const actor: ScopePrincipal = { modelId: 'codex', agentId: 'worker', accountId: 'account', role: 'agent' };
beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'wiki-application-'));
  fs = new FileSystemService(vault); access = new ScopeAccessPolicy(); service = new KnowledgeApplicationService(fs, access);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(vault, { recursive: true, force: true }); });
async function note(path: string, frontmatter: Record<string, any> = {}, content = 'Observation') {
  await fs.writeNote({ path, frontmatter, content }); return fs.readNoteRevision(path);
}
async function application(id = 'run-1', outcome = 'succeeded') {
  const revision = await note('Knowledge/Retry.md', { llm_wiki_type: 'knowledge' });
  return { id, knowledge: { path: 'Knowledge/Retry.md', revision }, environment: 'Node 22 / Windows', conditions: '멱등 요청만', outcome, observed: '3회 재시도 후 성공; 결제 요청에는 적용하지 않음' };
}
test('prepares historical applied revisions without silently upgrading them; missing verification is explicit', async () => {
  const record = await application();
  await note(record.knowledge.path, { llm_wiki_type: 'knowledge' }, 'Changed conditions');
  const prepared = await service.prepare([record], 'Inbox/Run.md', actor);
  expect(prepared.records[0].knowledge.revision).toBe(record.knowledge.revision);
  expect(prepared.guards[0].expectedRevision).not.toBe(record.knowledge.revision);
  await note('Inbox/Run.md', { knowledge_applications: prepared.records });
  const result = await service.read({ path: record.knowledge.path });
  expect(result.items[0]).toMatchObject({ outcome: 'succeeded', knowledgeState: 'changed_since_application', verificationState: 'not_supplied' });
  expect(result.warning).toMatch(/self-reported/);
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(4000);
});
test('keeps failed and inconclusive reports from different environments separate', async () => {
  const first = await application('failed', 'failed'); const second = { ...first, id: 'unknown', outcome: 'inconclusive', environment: 'Linux' };
  await note('Inbox/Run.md', { knowledge_applications: [first, second] });
  const result = await service.read({ path: first.knowledge.path });
  expect(result.items.map((r: any) => r.outcome)).toEqual(['failed', 'inconclusive']);
  expect(result.items.every((r: any) => r.knowledgeState === 'current_revision')).toBe(true);
});
test('refuses public experience records referring to private knowledge even for its owner', async () => {
  const a = await application();
  const path = '_scopes/agents/worker/Secret.md'; const revision = await note(path, { llm_wiki_type: 'knowledge' });
  a.knowledge = { path: 'scope://agent/worker/Secret.md', revision };
  await expect(service.prepare([a], 'Inbox/Public.md', actor)).rejects.toThrow(/unavailable|scope/i);
  await note('Inbox/Malformed.md', { knowledge_applications: [{ ...a, observed: 'PRIVATE-TEXT' }] });
  const result = await service.read({ path: 'Knowledge/Retry.md' });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE-TEXT|Secret|worker/);
});
test('rejects private links in experience prose and suppresses a legacy public record containing one', async () => {
  const a = await application(); await note('_scopes/agents/worker/Secret.md');
  const record = { ...a, observed: 'See [[_scopes/agents/worker/Secret.md]]' };
  await expect(service.prepare([record], 'Inbox/Run.md', actor)).rejects.toThrow(/unavailable|scope/i);
  await note('Inbox/Run.md', { knowledge_applications: [record] });
  expect(JSON.stringify(await service.read({ path: a.knowledge.path }))).not.toContain('Secret');
});
test('an unresolved private alias in legacy public prose is not echoed to public readers', async () => {
  const a = await application(); await note('_scopes/agents/worker/Secret.md', { aliases: ['confidential-project-alias'] });
  await note('Inbox/Run.md', { knowledge_applications: [{ ...a, observed: 'See [[confidential-project-alias]]' }] });
  const result = await service.read({ path: a.knowledge.path });
  expect(result.items).toEqual([]); expect(JSON.stringify(result)).not.toContain('confidential-project-alias');
});
test('stale missing candidates do not falsely finish a page before a visible observation', async () => {
  const a = await application(); await note('Inbox/Last.md', { knowledge_applications: [a] });
  vi.spyOn(fs, 'queryNotes').mockResolvedValue({ notes: [...Array.from({ length: 8 }, (_, i) => ({ path: `Inbox/Deleted${i}.md`, frontmatter: { knowledge_applications: [a] } })), { path: 'Inbox/Last.md', frontmatter: { knowledge_applications: [a] } }], total: 9, truncated: false });
  await expect(service.read({ path: a.knowledge.path })).rejects.toThrow(/unavailable|changed/i);
});
test('all final revision reads keep the same 8 MiB input bound', async () => {
  const a = await application(); await note('Inbox/Run.md', { knowledge_applications: [a] });
  const reads = vi.spyOn(fs, 'readNoteRevision');
  await service.read({ path: a.knowledge.path });
  expect(reads.mock.calls.length).toBeGreaterThan(0);
  expect(reads.mock.calls.every(call => call[1] === 8 * 1024 * 1024)).toBe(true);
});
test('oversized observations are retried intact and paginated without dropping conditions', async () => {
  const a = await application();
  const large = { ...a, conditions: '조건'.repeat(500), environment: '환'.repeat(500), observed: '관찰'.repeat(500), limitations: '한'.repeat(500) };
  await note('Inbox/Run.md', { knowledge_applications: [large, { ...a, id: 'next' }] });
  const first = await service.read({ path: a.knowledge.path, maxChars: 2000 });
  expect(JSON.stringify(first).length).toBeLessThanOrEqual(2000);
  expect(first.status).toBe('budget_too_small');
  const retried = await service.read(first.nextAction.arguments);
  expect(retried.items[0].conditions).toBe(large.conditions);
  expect(retried.items[1].id).toBe('next');
  expect(JSON.stringify(retried).length).toBeLessThanOrEqual(12000);
});
test('long exact locators cannot overflow the small-budget retry response', async () => {
  const path = `Knowledge/${'part/'.repeat(95)}A.md`, observation = `Inbox/${'segment/'.repeat(75)}Run.md`, revision = 'a'.repeat(64);
  const a = { id: 'long', knowledge: { path, revision }, environment: 'e'.repeat(500), conditions: 'c'.repeat(1000), outcome: 'failed', observed: 'o'.repeat(1000) };
  vi.spyOn(fs, 'readNoteMetadata').mockImplementation(async paths => paths.map(p => ({ path: p, revision, frontmatter: p === path ? { llm_wiki_type: 'knowledge' } : { knowledge_applications: [a] } })));
  vi.spyOn(fs, 'readNoteRevision').mockResolvedValue(revision);
  vi.spyOn(fs, 'queryNotes').mockResolvedValue({ notes: [{ path: observation, revision, frontmatter: { knowledge_applications: [a] } }], total: 1, truncated: false });
  const result = await service.read({ path, maxChars: 2000 });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  expect(result.status).toBe('budget_too_small');
});
test.each([false, true])('unrelated application owners do not consume the eight-owner current-source budget (indexed=%s)', async indexed => {
  const a = await application();
  await note('Knowledge/Other.md', { llm_wiki_type: 'knowledge' });
  for (let i = 0; i < 9; i++) await note(`Inbox/${i}.md`, { knowledge_applications: [{ ...a, knowledge: { ...a.knowledge, path: i === 8 ? a.knowledge.path : 'Knowledge/Other.md' } }] });
  const metadata = indexed ? new VaultMetadataIndex(vault, new PathFilter(), new FrontmatterHandler()) : undefined;
  if (metadata) {
    fs = new FileSystemService(vault, undefined, undefined, undefined, metadata);
    service = new KnowledgeApplicationService(fs, access);
  }
  try {
    const reads = vi.spyOn(fs, 'readNoteMetadata');
    const first = await service.read({ path: a.knowledge.path });
    expect(first.items).toHaveLength(1); expect(first.truncated).toBe(false);
    expect(reads.mock.calls.flatMap(call => call[0])).toEqual([a.knowledge.path, 'Inbox/8.md']);
  } finally { await metadata?.close(); }
});

test('owner admission normalizes exact scoped targets without admitting hidden or incompatible records', async () => {
  const path = '_scopes/agents/worker/Knowledge.md';
  const revision = await note(path, { llm_wiki_type: 'knowledge' });
  const a = { id: 'scoped', knowledge: { path: 'scope://agent/worker/Knowledge.md', revision }, environment: 'local', conditions: 'one run', outcome: 'failed', observed: 'scoped observation' };
  await note('_scopes/agents/worker/Owner.md', { knowledge_applications: [a] });
  await note('Inbox/Public.md', { knowledge_applications: [{ ...a, observed: 'PRIVATE-CANARY' }] });
  await note('_scopes/agents/worker/Hidden.md', { moderation_status: 'hidden', knowledge_applications: [a] });
  const result = await service.read({ path: 'scope://agent/worker/Knowledge.md', principal: actor });
  expect(result.items.map((r: any) => r.observation.path)).toEqual(['scope://agent/worker/Owner.md']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE-CANARY');
});

test('matching owners retain the eight-owner continuation and normalize physical dot segments', async () => {
  const a = await application();
  for (let i = 0; i < 9; i++) await note(`Inbox/Owner${i}.md`, { knowledge_applications: [{ ...a, id: `run-${i}`, knowledge: { ...a.knowledge, path: 'Knowledge/./Retry.md' } }] });
  const first = await service.read({ path: a.knowledge.path, maxChars: 12000 });
  expect(first.items.map((r: any) => r.id)).toEqual(Array.from({ length: 8 }, (_, i) => `run-${i}`));
  expect(first.truncated).toBe(true);
  const second = await service.read(first.nextAction.arguments);
  expect(second.items.map((r: any) => r.id)).toEqual(['run-8']);
  expect(second.truncated).toBe(false);
});

test('fresh owner records cannot inherit stale metadata target admission', async () => {
  const a = await application();
  const observation = 'Inbox/Run.md';
  await note(observation, { knowledge_applications: [a] });
  const query = fs.queryNotes.bind(fs);
  vi.spyOn(fs, 'queryNotes').mockImplementationOnce(async (...args) => {
    const candidates = await query(...args);
    await note(observation, { knowledge_applications: [{ ...a, knowledge: { ...a.knowledge, path: 'Knowledge/Other.md' }, observed: 'STALE-OWNER-CANARY' }] });
    return candidates;
  });
  const result = await service.read({ path: a.knowledge.path });
  expect(result.items).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('STALE-OWNER-CANARY');
});
test('read projection suppresses hidden verification and malformed records without leaking their text', async () => {
  const a = await application(); const revision = await note('Checks/Hidden.md', { moderation_status: 'hidden' });
  await note('Inbox/Run.md', { knowledge_applications: [{ ...a, observed: 'HIDDEN-EXPERIENCE', verification: { path: 'Checks/Hidden.md', revision } }] });
  await note('Inbox/Invalid.md', { knowledge_applications: [{ ...a, author: 'fake', observed: 'INVALID-EXPERIENCE' }] });
  const result = await service.read({ path: a.knowledge.path });
  expect(result.items).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/HIDDEN-EXPERIENCE|INVALID-EXPERIENCE|Hidden|Invalid/);
});
test('does not promote Community-only experience into a synchronizable Global record', async () => {
  const a = await application();
  const revision = await note('Community/Knowledge/Local.md', { llm_wiki_type: 'knowledge' });
  const record = { ...a, knowledge: { path: 'Community/Knowledge/Local.md', revision } };
  await expect(service.prepare([record], 'Inbox/Public.md', actor)).rejects.toThrow(/unavailable|scope/i);
  const local = await service.prepare([record], 'Community/Inbox/Run.md', actor);
  expect(local.records).toHaveLength(1);
});
test('rejects cursor reuse for different knowledge with identical content revisions', async () => {
  const a = await application(); await note('Knowledge/Same.md', { llm_wiki_type: 'knowledge' });
  await note('Inbox/Run.md', { knowledge_applications: [a, { ...a, id: 'second' }] });
  const result = await service.read({ path: a.knowledge.path, limit: 1 });
  await expect(service.read({ path: 'Knowledge/Same.md', cursor: result.nextCursor })).rejects.toThrow(/cursor/i);
});
test('paginates within one note without dropping records and pins continuation to its revision', async () => {
  const a = await application();
  await note('Inbox/Run.md', { knowledge_applications: [a, { ...a, id: 'second' }] });
  const first = await service.read({ path: a.knowledge.path, limit: 1 });
  expect(first.items.map((r: any) => r.id)).toEqual(['run-1']);
  const second = await service.read({ path: a.knowledge.path, limit: 1, cursor: first.nextCursor });
  expect(second.items.map((r: any) => r.id)).toEqual(['second']);
  await note('Inbox/Run.md', { knowledge_applications: [a] }, 'Changed');
  await expect(service.read({ path: a.knowledge.path, cursor: first.nextCursor })).rejects.toThrow(/changed|revision/i);
});
test('related-note guards reject a changed input instead of recording a stale validation', async () => {
  const a = await application(); const prepared = await service.prepare([a], 'Inbox/Run.md', actor);
  await note(a.knowledge.path, { llm_wiki_type: 'knowledge' }, 'changed');
  await expect(fs.writeNoteWithRevisionGuardsAndReceipt({ path: 'Inbox/Run.md', content: 'run', frontmatter: { knowledge_applications: prepared.records }, expectedRevision: 'missing' }, prepared.guards)).rejects.toThrow(/Revision conflict/i);
  expect(await fs.noteExists('Inbox/Run.md')).toBe(false);
});
test('rejects late access revocation rather than returning an old observation', async () => {
  const a = await application(); await note('Inbox/Run.md', { knowledge_applications: [a] });
  const read = fs.readNoteRevision.bind(fs); let revoked = false;
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation(() => !revoked);
  vi.spyOn(fs, 'readNoteRevision').mockImplementation(async (...args) => { const revision = await read(...args); revoked = true; return revision; });
  await expect(service.read({ path: a.knowledge.path })).rejects.toThrow(/unavailable|changed/i);
});
test('existing Inbox capture stores experience and rejects a changed related note before writing', async () => {
  const a = await application(); const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const result = await wiki.capture({ path: 'Inbox/Run.md', content: 'Experiment observations', capturedBy: 'worker', principal: actor, knowledgeApplications: [a] });
  expect((await fs.readNote(result.path)).frontmatter.knowledge_applications).toEqual([a]);
  const guarded = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => { await note(a.knowledge.path, { llm_wiki_type: 'knowledge' }, 'racing change'); return guarded(...args); });
  await expect(wiki.capture({ path: 'Inbox/Race.md', content: 'Not committed', capturedBy: 'worker', principal: actor, knowledgeApplications: [a] })).rejects.toThrow(/Revision conflict/i);
  expect(await fs.noteExists('Inbox/Race.md')).toBe(false);
});
test('existing task retrospective stores applications without replacing manual prose or completing from success alone', async () => {
  const a = await application(); const tasks = new AgentTaskService(fs, new ReferenceService(fs, access), new ScopeAuthService(vault));
  const created = await tasks.create({ principal: actor, title: 'Retry', description: 'Manual prose' });
  await expect(tasks.update({ principal: actor, taskId: created.taskId, status: 'completed', reason: 'done', expectedRevision: created.revision, knowledgeApplications: [a] })).rejects.toThrow(/disposition|retrospective/i);
  const update = await tasks.update({ principal: actor, taskId: created.taskId, expectedRevision: created.revision, retrospective: 'Only safe for idempotent reads', knowledgeApplications: [a] });
  const result = await fs.readNote(`Community/Tasks/${created.taskId}.md`);
  expect(result.frontmatter.knowledge_applications).toEqual([a]);
  expect(result.content).toContain('Manual prose');
  await expect(tasks.update({ principal: actor, taskId: created.taskId, expectedRevision: created.revision, knowledgeApplications: [] })).rejects.toThrow(/Revision conflict/i);
  await tasks.update({ principal: actor, taskId: created.taskId, expectedRevision: update.revision, knowledgeApplications: [] });
  expect((await fs.readNote(`Community/Tasks/${created.taskId}.md`)).frontmatter.knowledge_applications).toEqual([]);
});
test('publication can explicitly repair malformed existing application metadata without weakening source requirements', async () => {
  const wiki = new LlmWikiService(fs, access, new ReferenceService(fs, access));
  const a = await application();
  const source = await wiki.ingestSource({ title: 'Run output', content: 'Measured observation', capturedBy: 'worker', principal: actor });
  const before = await note('Knowledge/Experiment.md', { llm_wiki_type: 'knowledge', knowledge_applications: [{ invalid: true }] });
  const published = await wiki.publishKnowledge({ path: 'Knowledge/Experiment.md', content: 'Observed results', evidencePaths: [source.path], expectedRevision: before, author: 'worker', principal: actor, knowledgeApplications: [a] });
  expect((await fs.readNote(published.path)).frontmatter.knowledge_applications).toEqual([a]);
  await expect(wiki.publishKnowledge({ path: 'Knowledge/WithoutSource.md', content: 'Experience alone', evidencePaths: [], expectedRevision: 'missing', author: 'worker', knowledgeApplications: [a] })).rejects.toThrow(/evidence/i);
});
