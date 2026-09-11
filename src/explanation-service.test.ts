import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import { ExplanationService } from './explanation-service.js';

let root: string, base: string, fs: FileSystemService, service: ExplanationService, revoked: boolean;
const actor = (accountId: string, modelId = accountId): ScopePrincipal => ({ accountId, modelId, agentId: accountId, userId: 'owner', role: 'agent', capabilities: ['task'] } as ScopePrincipal);
const writer = actor('writer', 'gemini'), reviewer = actor('reviewer', 'gpt');
const draft = { blocks: [{ text: '비밀번호는 공개하지 마세요. Never disclose passwords.', startLine: 1, endLine: 1 }] };
const review = { checks: ['fidelity', 'coverage', 'no_invention', 'clarity'].map(criterion => ({ criterion, verdict: 'pass', reason: 'The sole prohibition is preserved.', blockIndices: [0] })) };
beforeEach(async () => {
  base = await realpath(tmpdir()); root = await mkdtemp(join(base, 'mcpvault-explanation-'));
  fs = new FileSystemService(root); revoked = false;
  await fs.writeNote({ path: 'Guide.md', content: 'Never disclose passwords.\n', expectedRevision: 'missing' });
  service = new ExplanationService(fs, new ScopeAccessPolicy(), {
    sources: [{ path: 'Guide.md' }],
    executionProfiles: async () => [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] })),
    assertActor: async p => { if (revoked || ![writer.accountId, reviewer.accountId].includes(p.accountId)) throw Error('Actor revoked'); },
  });
});
afterEach(async () => {
  const actual = await realpath(root), rel = relative(base, actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(actual).startsWith('mcpvault-explanation-')) throw Error('Unsafe cleanup');
  await rm(actual, { recursive: true, force: true });
});
const read = (principal?: ScopePrincipal) => service.execute('read', { sourcePath: 'Guide.md' }, principal);
async function claim() {
  const source = await fs.readNote('Guide.md');
  return service.execute('claim', { sourcePath: 'Guide.md', expectedSourceRevision: source.revision, expectedRevision: 'missing', requestId: 'claim-1' }, writer);
}
async function submit() {
  const c = await claim();
  return service.execute('draft', { sourcePath: 'Guide.md', expectedSourceRevision: c.sourceRevision, expectedRevision: c.revision, requestId: 'draft-1', draft }, writer);
}
test('only configured sources are jobs; claims are voluntary and retry-safe', async () => {
  const jobs = await service.execute('list', {}, writer);
  expect(jobs.items).toHaveLength(1); expect(jobs.items[0].status).toBe('queued');
  const first = await claim(); expect((await claim()).revision).toBe(first.revision);
  await expect(service.execute('read', { sourcePath: '../private.md' }, writer)).rejects.toThrow(/unavailable|source/i);
});
test('unverified drafts remain unavailable to public readers', async () => {
  await submit();
  expect(JSON.stringify(await read())).not.toContain('비밀번호');
  expect((await read(reviewer)).items[0].text).toBe(draft.blocks[0]!.text);
});
test('cross-family review unlocks reuse; changed source immediately disables it', async () => {
  const d = await submit();
  const approved = await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'review-1', review }, reviewer);
  expect(approved.status).toBe('approved');
  expect(await read()).toMatchObject({ status: 'approved', route: { kind: 'verified_explanation' } });
  const source = await fs.readNote('Guide.md');
  await fs.writeNote({ path: 'Guide.md', content: 'Never disclose passwords or tokens.\n', expectedRevision: source.revision });
  const current = await read(); expect(current.status).toBe('queued'); expect(JSON.stringify(current)).not.toContain('비밀번호');
});

test('optional approved action reveals no draft and pins source plus review record', async () => {
  const d = await submit();
  const params = { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision };
  expect(await service.approvedAction(params)).toBeUndefined();
  const reviewed = await service.execute('review', { ...params, expectedRevision: d.revision, requestId: 'hint-review', review }, reviewer);
  expect(await service.approvedAction(params)).toEqual({ endpointId: 'explanations.read', arguments: { ...params, expectedRevision: reviewed.revision, maxChars: 4000 } });
  expect(await service.approvedAction({ sourcePath: 'Unconfigured.md', expectedSourceRevision: d.sourceRevision })).toBeUndefined();
  const current = await fs.readNote('Guide.md');
  await fs.writeNote({ path: 'Guide.md', content: 'Changed original.', expectedRevision: current.revision });
  await expect(service.approvedAction(params)).rejects.toThrow(/changed/i);
});
test('self review and revoked actors cannot approve or disclose drafts', async () => {
  const d = await submit();
  const params = { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'review-1', review };
  await expect(service.execute('review', params, writer)).rejects.toThrow(/independent|review/i);
  revoked = true;
  await expect(service.execute('review', params, reviewer)).rejects.toThrow(/revoked/i);
  await expect(read(reviewer)).rejects.toThrow(/revoked/i);
});
test('concurrent claims cannot replace ownership', async () => {
  const source = await fs.readNote('Guide.md');
  const params = { sourcePath: 'Guide.md', expectedSourceRevision: source.revision, expectedRevision: 'missing', requestId: 'claim-race' };
  const results = await Promise.allSettled([service.execute('claim', params, writer), service.execute('claim', params, reviewer)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
});

test('read provides the precise voluntary continuation and a private Obsidian-readable snapshot', async () => {
  expect((await read(writer)).nextAction.endpointId).toBe('explanations.claim');
  const c = await claim();
  expect((await read(writer)).nextAction.endpointId).toBe('explanations.draft');
  const d = await service.execute('draft', { sourcePath: 'Guide.md', expectedSourceRevision: c.sourceRevision, expectedRevision: c.revision, requestId: 'draft-1', draft }, writer);
  expect((await read(reviewer)).nextAction.endpointId).toBe('explanations.review');
  const snapshot = await fs.readNote(`_whispers/explanations/${d.id}.md`);
  expect(snapshot.content).toContain(draft.blocks[0]!.text);
  expect(snapshot.content).toContain('snapshot');
  expect((await read()).nextAction).toBeUndefined();
});

test('one writer cannot claim two current jobs and pulse resumes the existing job', async () => {
  await fs.writeNote({ path: 'Other.md', content: 'A simple guide.', expectedRevision: 'missing' });
  const profiles = async () => [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: '1', hostVerified: true, tier: 'standard' as const, capabilities: ['task'], tools: [] }));
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Other.md' }, { path: 'Guide.md' }], executionProfiles: profiles, assertActor: async () => {} });
  await claim();
  const other = await service.execute('read', { sourcePath: 'Other.md' }, writer);
  expect(other.nextAction).toBeUndefined();
  await expect(service.execute('claim', { sourcePath: 'Other.md', expectedSourceRevision: other.sourceRevision, expectedRevision: 'missing', requestId: 'other-claim' }, writer)).rejects.toThrow(/WIP/);
  expect((await service.nextAction(writer))?.arguments.sourcePath).toBe('Guide.md');
  const peerClaim = await service.execute('claim', { sourcePath: 'Other.md', expectedSourceRevision: other.sourceRevision, expectedRevision: 'missing', requestId: 'peer-claim' }, reviewer);
  await service.execute('draft', { sourcePath: 'Other.md', expectedSourceRevision: other.sourceRevision, expectedRevision: peerClaim.revision, requestId: 'peer-draft', draft: { blocks: [{ text: 'A simple guide.', startLine: 1, endLine: 1 }] } }, reviewer);
  expect((await service.nextAction(writer))?.arguments.sourcePath).toBe('Guide.md');
});

test('approved reuse rechecks account and model authority without leaking old public text', async () => {
  let available = true;
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Guide.md' }],
    executionProfiles: async () => [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] })),
    assertActor: async () => {}, accountAvailable: async () => available });
  const d = await submit();
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'approve', review }, reviewer);
  expect((await read()).route.kind).toBe('verified_explanation');
  available = false;
  const result = await read();
  expect(result.route.kind).toBe('original_source');
  expect(JSON.stringify(result)).not.toContain('비밀번호');
});

test('host configuration drift blocks admission and the final durable boundary', async () => {
  let changed = true;
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Guide.md' }], assertActor: async () => {},
    executionProfiles: async () => { if (changed) throw Error('Host policy changed'); return [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] })); } });
  await expect(claim()).rejects.toThrow(/policy changed/);
  changed = false;
  const original = fs.writeNoteWithRevisionGuardsAndReceipt.bind(fs);
  const spy = vi.spyOn(fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => { changed = true; return original(...args); });
  try { await expect(claim()).rejects.toThrow(/policy changed/); } finally { spy.mockRestore(); }
  changed = false;
  expect((await read()).status).toBe('queued');
});

test('a task account outside the verified host profile set cannot reserve an explanation job', async () => {
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Guide.md' }], assertActor: async () => {}, executionProfiles: async () => [] });
  await expect(claim()).rejects.toThrow(/verified.*profile/i);
  expect((await read()).status).toBe('queued');
});

test('restarted reviewer profile drift invalidates reuse and permits an explicit new review', async () => {
  const d = await submit();
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'approve', review }, reviewer);
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Guide.md' }], assertActor: async () => {},
    executionProfiles: async () => [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: p === reviewer ? '2' : '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] })) });
  expect((await read()).route.kind).toBe('original_source');
  const stale = await read(reviewer);
  expect(stale.status).toBe('review_required');
  expect(stale.nextAction.endpointId).toBe('explanations.review');
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: stale.sourceRevision, expectedRevision: stale.revision, requestId: 'review-new-profile', review }, reviewer);
  expect((await read()).route.kind).toBe('verified_explanation');
});

test('author profile changes require a new draft instead of reattributing old prose', async () => {
  const d = await submit();
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'approve', review }, reviewer);
  service = new ExplanationService(fs, new ScopeAccessPolicy(), { sources: [{ path: 'Guide.md' }], assertActor: async () => {},
    executionProfiles: async () => [writer, reviewer].map(p => ({ accountId: p.accountId, family: p.modelId, version: p === writer ? '2' : '1', hostVerified: true, tier: 'standard', capabilities: ['task'], tools: [] })) });
  const stale = await read(writer);
  expect((await read()).route.kind).toBe('original_source');
  expect(stale.nextAction.endpointId).toBe('explanations.draft');
  await expect(service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: stale.sourceRevision, expectedRevision: stale.revision, requestId: 'stale-author-review', review }, reviewer)).rejects.toThrow(/author.*profile|draft.*basis/i);
  const fresh = await service.execute('draft', { sourcePath: 'Guide.md', expectedSourceRevision: stale.sourceRevision, expectedRevision: stale.revision, requestId: 'new-author-draft', draft }, writer);
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: fresh.sourceRevision, expectedRevision: fresh.revision, requestId: 'new-author-review', review }, reviewer);
  expect((await read()).route.kind).toBe('verified_explanation');
});

test('approved read observes source hiding during its final job-record await', async () => {
  const d = await submit();
  await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: d.sourceRevision, expectedRevision: d.revision, requestId: 'approve', review }, reviewer);
  const original = fs.readNote.bind(fs); let records = 0;
  const spy = vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0].startsWith('_whispers/explanations/') && ++records === 2) {
      const source = await original('Guide.md');
      await fs.writeNote({ path: 'Guide.md', content: source.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: source.revision });
    }
    return result;
  });
  try { await expect(read()).rejects.toThrow(/changed|unavailable/i); } finally { spy.mockRestore(); }
});

test.each([['moderation', 1], ['acl', 1], ['moderation', 3], ['acl', 3]] as const)('list refuses earlier metadata invalidated during a later source read: %s/%i', async (kind, atRead) => {
  await fs.writeNote({ path: 'Other.md', content: 'Another guide.', expectedRevision: 'missing' });
  let allowed = true, triggered = false, otherReads = 0;
  const access = new ScopeAccessPolicy();
  const originalAccess = access.canAccessPhysicalPath.bind(access);
  vi.spyOn(access, 'canAccessPhysicalPath').mockImplementation((path, p) => (path !== 'Guide.md' || allowed) && originalAccess(path, p));
  service = new ExplanationService(fs, access, { sources: [{ path: 'Guide.md' }, { path: 'Other.md' }], assertActor: async () => {},
    executionProfiles: async () => [] });
  const original = fs.readNote.bind(fs);
  const spy = vi.spyOn(fs, 'readNote').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0] === 'Other.md' && ++otherReads === atRead && !triggered) {
      triggered = true;
      if (kind === 'acl') allowed = false;
      else {
        const source = await original('Guide.md');
        await fs.writeNote({ path: 'Guide.md', content: source.content, frontmatter: { moderation_status: 'hidden' }, expectedRevision: source.revision });
      }
    }
    return result;
  });
  try { await expect(service.execute('list', {}, writer)).rejects.toThrow(/changed|unavailable/i); } finally { spy.mockRestore(); }
});

test.each(['\u0001', '\ud800'])('serialized-oversized blocks cannot create unreadable drafts: %j', async unit => {
  const source = await fs.readNote('Guide.md');
  await fs.writeNote({ path: 'Guide.md', content: 'A simple guide.', expectedRevision: source.revision });
  const c = await claim();
  await expect(service.execute('draft', { sourcePath: 'Guide.md', expectedSourceRevision: c.sourceRevision, expectedRevision: c.revision,
    requestId: 'unreadable-draft', draft: { blocks: [{ text: unit.repeat(3000), startLine: 1, endLine: 1 }] } }, writer)).rejects.toThrow(/serialized|budget/i);
  expect((await read(writer)).revision).toBe(c.revision);
});

test('serialized UTF-8 record limits reject oversized review before replacing a readable draft', async () => {
  const source = await fs.readNote('Guide.md');
  await fs.writeNote({ path: 'Guide.md', content: 'A simple guide.', expectedRevision: source.revision });
  const c = await claim();
  const blocks = Array.from({ length: 8 }, () => ({ text: '가'.repeat(3000), startLine: 1, endLine: 1 }));
  const d = await service.execute('draft', { sourcePath: 'Guide.md', expectedSourceRevision: c.sourceRevision, expectedRevision: c.revision, requestId: 'large-draft', draft: { blocks } }, writer);
  const longReview = { checks: review.checks.map(check => ({ ...check, verdict: 'changes', reason: '가'.repeat(1200), blockIndices: blocks.map((_, i) => i) })) };
  let current = d, rejected = false;
  for (let index = 0; index < 100; index++) {
    try { current = await service.execute('review', { sourcePath: 'Guide.md', expectedSourceRevision: c.sourceRevision, expectedRevision: current.revision, requestId: `review-${index}`, review: longReview }, reviewer); }
    catch (error) { expect(String(error)).toMatch(/record.*byte|byte.*budget/i); rejected = true; break; }
  }
  expect(rejected).toBe(true);
  expect((await service.execute('read', { sourcePath: 'Guide.md', maxChars: 12000 }, writer)).revision).toBe(current.revision);
});
