import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemService } from './filesystem.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { ScopeAuthService } from './scope-auth.js';
import { FrontmatterHandler } from './frontmatter.js';
import { proceduralLines } from './skill-evaluation.js';
import { projectSkill, previewSkills, applySkills } from './skill-library.js';

const vaults: string[] = [];
vi.setConfig({ testTimeout: 30000 });
afterEach(async () => { for (const root of vaults.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-evolution-')); vaults.push(root);
  const fs = new FileSystemService(root), access = new ScopeAccessPolicy(), auth = new ScopeAuthService(root);
  const ownerSession = await auth.register({ accountId: 'owner', modelId: 'test', password: 'fixture-password-only' });
  const owner = ownerSession.principal, ownerToken = ownerSession.accessToken;
  const reviewerSession = await auth.register({ accountId: 'reviewer', modelId: 'reviewer', password: 'fixture-password-only' });
  const reviewer = reviewerSession.principal, reviewerToken = reviewerSession.accessToken;
  const projections = projectSkill({ id: 'safe-edit', origin: 'synthetic-fixture', version: '1', license: 'MIT',
    licenseText: 'MIT License\nPermission is hereby granted, free of charge', description: 'revision safe editing',
    files: [{ path: 'SKILL.md', text: '# Revision safe editing\n\nread\npatch\n' }], unavailable: [] });
  await applySkills(fs, projections, (await previewSkills(fs, projections)).fingerprint);
  await fs.writeNote({ path: 'Evidence/edit.md', content: 'Observed a missing verification after patching.' });
  const evidence = { path: 'Evidence/edit.md', revision: (await fs.readNote('Evidence/edit.md')).revision };
  const profile = { id: 'safe-edit-v1', revision: '1', skillId: 'safe-edit', caseIds: ['keeps-read', 'verifies'], targetCaseIds: ['verifies'], maxDurationMs: 1000,
    evaluate: async ({ baseline, candidate }: { baseline: string; candidate: string }) => ({ risk: 'low' as const, cases: [
      { id: 'keeps-read', baseline: proceduralLines(baseline).includes('read'), candidate: proceduralLines(candidate).includes('read') },
      { id: 'verifies', baseline: proceduralLines(baseline).includes('verify'), candidate: proceduralLines(candidate).includes('verify') },
    ] }) };
  const host = { enabled: true, attestationKey: 'synthetic-host-key-not-for-production-123456789', approverAccounts: ['reviewer'], profiles: [profile] };
  const module = await import('./skill-evolution.js').catch(() => ({ SkillEvolutionService: undefined }));
  expect(module.SkillEvolutionService, 'skill evolution service exists').toBeTypeOf('function');
  const service = new module.SkillEvolutionService!(fs, access, auth, host);
  const resolve = () => service.resolve({ skillId: 'safe-edit', principal: owner, accessToken: ownerToken });
  const experience = async (extra: Record<string, unknown> = {}) => {
    const current = await resolve();
    return service.experience({ skillId: 'safe-edit', principal: owner, accessToken: ownerToken, expectedRevision: 'missing', requestId: 'experience-1',
      usedVersion: { path: current.path, revision: current.revision }, applied: true, outcome: 'failure',
      context: 'Synthetic revision-safe editing task', summary: 'Patch was not verified.', shareable: true, evidence: [evidence], ...extra });
  };
  const candidate = async (extra: Record<string, unknown> = {}) => {
    const current = await resolve(), e = await experience();
    return service.candidate({ op: 'create', skillId: 'safe-edit', principal: owner, accessToken: ownerToken, requestId: 'candidate-1', expectedRevision: 'missing',
      baseRevision: current.revision, expectedCurrentRevision: current.currentRevision, content: '# Revision safe editing\n\nread\npatch\nverify\n',
      reason: 'Verify the written revision after applying a patch.', conditions: 'An authorized note patch.', experiences: [{ path: e.path, revision: e.revision }], ...extra });
  };
  const evaluate = async (c: any) => service.evaluate({ skillId: 'safe-edit', principal: owner, accessToken: ownerToken, candidateId: c.candidateId,
    expectedRevision: c.revision, requestId: `evaluate-${c.candidateId}`, op: 'run' });
  const promote = async (c: any, e: any, extra: Record<string, unknown> = {}) => {
    const args = { skillId: 'safe-edit', principal: owner, accessToken: ownerToken, candidateId: c.candidateId, evaluationId: e.evaluationId,
      expectedRevision: (await resolve()).currentRevision, mode: 'auto', ...extra };
    const preview = await service.promote({ ...args, op: 'preview' });
    return service.promote({ ...args, op: 'apply', fingerprint: preview.fingerprint, requestId: `promote-${c.candidateId}` });
  };
  const externalEdit = async (args: Parameters<FileSystemService['writeNote']>[0]) => {
    if (!args.path.includes('/_evolution/')) return fs.writeNote(args);
    await writeFile(join(root, args.path), args.frontmatter ? new FrontmatterHandler().stringify(args.frontmatter, args.content) : args.content, 'utf8');
  };
  return { root, fs, externalEdit, access, auth, owner, ownerToken, reviewer, reviewerToken, host, service, resolve, evidence, experience, candidate, evaluate, promote };
}

test('experience -> candidate -> host evaluation -> promotion -> current version -> rollback preserves original', async () => {
  const f = await fixture(), original = await f.resolve();
  expect(original.status).toBe('original');
  const c = await f.candidate(), evaluation = await f.evaluate(c);
  expect(evaluation.status).toBe('passed');
  expect(evaluation.nextAction.endpointId).toBe('skill.promote');
  const promoted = await f.promote(c, evaluation), current = await f.resolve();
  expect(current.status).toBe('active'); expect(current.content).toContain('\nverify\n');
  expect(current.path).not.toBe(original.path); expect(promoted.revision).toBe(current.currentRevision);
  expect((await f.fs.readNote(original.path)).revision).toBe(original.revision);
  const args = { skillId: 'safe-edit', principal: f.reviewer, accessToken: f.reviewerToken, expectedRevision: current.currentRevision, reason: 'Confirmed regression in a new environment.' };
  const preview = await f.service.rollback({ ...args, op: 'preview' });
  await f.service.rollback({ ...args, op: 'apply', fingerprint: preview.fingerprint, requestId: 'rollback-1' });
  expect((await f.resolve()).path).toBe(original.path);
  expect(await f.fs.noteExists(c.path)).toBe(true);
});

test('reading alone and narrower-scope evidence cannot become shared experience', async () => {
  const f = await fixture();
  await expect(f.experience({ applied: false })).rejects.toThrow(/applied|use/i);
  await expect(f.experience({ shareable: false })).rejects.toThrow(/share/i);
  await f.externalEdit({ path: '_scopes/models/test/secret.md', content: 'private-marker' });
  const hidden = await f.fs.readNote('_scopes/models/test/secret.md');
  await expect(f.experience({ evidence: [{ path: '_scopes/models/test/secret.md', revision: hidden.revision }] })).rejects.toThrow(/shared|private|scope|unavailable/i);
  await expect(f.experience({ summary: 'Read [[scope://model/test/secret.md]]' })).rejects.toThrow(/private|scope|shared/i);
});

test('retries return the same record but changed payload cannot reuse its request ID', async () => {
  const f = await fixture(), first = await f.experience(), second = await f.experience();
  expect(second.path).toBe(first.path); expect(second.revision).toBe(first.revision);
  await expect(f.experience({ summary: 'A different result' })).rejects.toThrow(/requestId|retry/i);
});

test('candidate creation retries survive later rejection and signed old candidate replay is rejected', async () => {
  const f = await fixture(), c = await f.candidate(), original = await f.fs.readNote(c.path);
  await f.service.candidate({ skillId: 'safe-edit', principal: f.owner, accessToken: f.ownerToken, op: 'reject', candidateId: c.candidateId,
    expectedRevision: c.revision, requestId: 'reject-for-replay', reason: 'Not applicable.' });
  expect(await f.candidate()).toEqual(c);
  await f.externalEdit({ path: c.path, content: original.originalContent });
  await expect(f.evaluate(c)).rejects.toThrow(/fresh|replay|changed|journal/i);
});

test('restoring an older signed current pointer cannot silently reactivate it', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c); await f.promote(c, e);
  const path = 'Community/Skills/safe-edit/_evolution/current.md', old = await f.fs.readNote(path);
  const args = { skillId: 'safe-edit', principal: f.reviewer, accessToken: f.reviewerToken, expectedRevision: old.revision, reason: 'Verified regression.' };
  const preview = await f.service.rollback({ ...args, op: 'preview' });
  await f.service.rollback({ ...args, op: 'apply', fingerprint: preview.fingerprint, requestId: 'rollback-replay' });
  await f.externalEdit({ path, content: old.originalContent });
  expect((await f.resolve()).status).toBe('needs_review');
});

test('rollback retains and verifies the previous version evaluation provenance', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c); await f.promote(c, e);
  const first = await f.resolve(), exp = await f.experience({ requestId: 'use-v1' });
  const next = await f.service.candidate({ skillId: 'safe-edit', principal: f.owner, accessToken: f.ownerToken, op: 'create', requestId: 'candidate-v2',
    expectedRevision: 'missing', baseRevision: first.revision, expectedCurrentRevision: first.currentRevision,
    content: '# Procedure v2\nread\npatch\nverify\n', conditions: 'Authorized patch', reason: 'Review wording', experiences: [{ path: exp.path, revision: exp.revision }] });
  const nextEvaluation = await f.evaluate(next);
  await f.promote(next, nextEvaluation, { principal: f.reviewer, accessToken: f.reviewerToken, mode: 'approved', reason: 'Reviewed wording.' });
  const args = { skillId: 'safe-edit', principal: f.reviewer, accessToken: f.reviewerToken, op: 'preview', expectedRevision: (await f.resolve()).currentRevision, reason: 'Revert wording regression.' };
  expect((await f.service.rollback(args)).target.path).toBe(first.path);
  const evaluation = await f.fs.readNote(e.path);
  await f.externalEdit({ path: e.path, content: evaluation.content + '\nEdited result', frontmatter: evaluation.frontmatter, expectedRevision: evaluation.revision });
  await expect(f.service.rollback(args)).rejects.toThrow(/changed|revision|attest|evaluation/i);
});

test('public principal metadata cannot impersonate an authenticated skill writer', async () => {
  const f = await fixture();
  await expect(f.experience({ accessToken: undefined, principal: { ...f.owner } })).rejects.toThrow(/auth|session/i);
});

test.each(['before-target', 'after-target', 'before-commit'])('an interrupted %s write resumes the same request without duplicate experience', async stage => {
  const f = await fixture(); let interrupted = false;
  const originalGuarded = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  const originalReceipt = f.fs.writeNoteWithReceipt.bind(f.fs);
  const guarded = vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (!interrupted && stage !== 'before-commit' && args[0].path.includes('/experiences/')) {
      interrupted = true;
      if (stage === 'after-target') await originalGuarded(...args);
      throw Error('Synthetic interruption');
    }
    return originalGuarded(...args);
  });
  const receipts = vi.spyOn(f.fs, 'writeNoteWithReceipt').mockImplementation(async (...args) => {
    if (!interrupted && stage === 'before-commit' && args[0].path.includes('/commits/')) { interrupted = true; throw Error('Synthetic interruption'); }
    return originalReceipt(...args);
  });
  await expect(f.experience()).rejects.toThrow(/interruption/);
  guarded.mockRestore(); receipts.mockRestore();
  const result = await f.experience(); expect(await f.experience()).toEqual(result);
  const rows = await f.fs.queryNotes({ pathPrefix: 'Community/Skills/safe-edit/_evolution/experiences/', limit: 10 });
  expect(rows.notes).toHaveLength(1);
  await rm(join(f.root, result.path)); // Simulate a direct external deletion of this synthetic test record.
  expect(await f.experience()).toEqual(result); // Historical receipt, never resurrection.
  expect(await f.fs.noteExists(result.path)).toBe(false);
});

test('session revoked during evaluation cannot persist an evaluation', async () => {
  const f = await fixture(), c = await f.candidate(), evaluator = f.host.profiles[0]!.evaluate;
  f.host.profiles[0]!.evaluate = async input => { f.auth.logout(f.ownerToken); return evaluator(input); };
  await expect(f.evaluate(c)).rejects.toThrow(/auth|session|token/i);
  expect((await f.fs.queryNotes({ pathPrefix: 'Community/Skills/safe-edit/_evolution/evaluations/', limit: 10 })).notes).toHaveLength(0);
});

test('prepared evaluation cannot persist an old profile snapshot under new guards', async () => {
  const f = await fixture(), c = await f.candidate(), original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    if (args[0].path.includes('/evaluations/')) throw Error('Synthetic interruption');
    return original(...args);
  });
  await expect(f.evaluate(c)).rejects.toThrow(/interruption/); spy.mockRestore();
  f.host.profiles[0]!.revision = 'new-profile';
  await expect(f.evaluate(c)).rejects.toThrow(/prepared|policy|guard/i);
  expect((await f.fs.queryNotes({ pathPrefix: 'Community/Skills/safe-edit/_evolution/evaluations/', limit: 10 })).notes).toHaveLength(0);
});

test('post-write evidence drift leaves an uncommitted result and retry cannot certify it', async () => {
  const f = await fixture(), original = f.fs.writeNoteWithRevisionGuardsAndReceipt.bind(f.fs);
  const spy = vi.spyOn(f.fs, 'writeNoteWithRevisionGuardsAndReceipt').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[0].path.includes('/experiences/')) await f.fs.writeNote({ path: f.evidence.path, content: 'Changed concurrently.' });
    return result;
  });
  await expect(f.experience()).rejects.toThrow(/revision|changed/); spy.mockRestore();
  await expect(f.experience()).rejects.toThrow(/revision|changed/);
  const rows = await f.fs.queryNotes({ pathPrefix: 'Community/Skills/safe-edit/_evolution/experiences/', limit: 10 });
  expect(rows.notes).toHaveLength(1);
  await expect(f.service.store.record(rows.notes[0]!.path, f.owner)).rejects.toThrow(/fresh|interrupted/);
});

test('generic file writes and ancestor moves cannot rewrite service decision journals', async () => {
  const f = await fixture(), c = await f.candidate();
  await expect(f.fs.writeNote({ path: c.path, content: 'forged' })).rejects.toThrow(/managed|skill/i);
  await expect(f.fs.writeNote({ path: 'Community/Skills/safe-edit/_evolution/receipts/forged.md', content: 'forged' })).rejects.toThrow(/managed|skill/i);
  expect((await f.fs.readNote(c.path)).revision).toBe(c.revision);
});

test('hidden candidates do not contribute to public listing cursor positions', async () => {
  const f = await fixture();
  const candidates = [await f.candidate(), await f.candidate({ requestId: 'second' }), await f.candidate({ requestId: 'third' })]
    .sort((a, b) => a.path.localeCompare(b.path));
  const hidden = candidates[0]!, note = await f.fs.readNote(hidden.path);
  await f.externalEdit({ path: hidden.path, content: note.content, frontmatter: { ...note.frontmatter, moderation_status: 'hidden' } });
  const first = await f.service.candidate({ skillId: 'safe-edit', op: 'list', limit: 1, maxChars: 4000 });
  expect(first.items).toHaveLength(1); expect(first.cursor).toMatch(/:1$/);
  expect(JSON.stringify(first)).not.toContain(hidden.candidateId);
});

test('shared text rejects private aliases and embeds, but accepts visible public links', async () => {
  const f = await fixture();
  await f.externalEdit({ path: '_scopes/models/test/customer.md', content: 'Private', frontmatter: { aliases: ['customer-secret'] } });
  await expect(f.experience({ summary: 'Observed ![[customer-secret]]' })).rejects.toThrow(/private|reference|scope/i);
  await expect(f.candidate({ content: '# Procedure\nread\n![[customer-secret]]\nverify\n' })).rejects.toThrow(/private|reference|scope/i);
  expect((await f.experience({ requestId: 'public-link', summary: 'Observed [[Evidence/edit.md]]' })).kind).toBe('experience');
});

test('missing profiles retain a review-required candidate and cannot auto-promote', async () => {
  const f = await fixture(); f.host.profiles = [];
  const c = await f.candidate(), e = await f.evaluate(c);
  expect(e.status).toBe('review_required');
  await expect(f.promote(c, e)).rejects.toThrow(/evaluation|review|profile/i);
  expect((await f.resolve()).status).toBe('original');
});

test('synthetic profile ignores fenced examples and records non-failure outcomes without counting reads', async () => {
  const f = await fixture();
  expect((await f.experience({ requestId: 'success', outcome: 'success' })).outcome).toBe('success');
  expect((await f.experience({ requestId: 'unknown', outcome: 'unknown' })).outcome).toBe('unknown');
  const c = await f.candidate({ content: '# Procedure\nread\npatch\n~~~text\nverify\n~~~\n' });
  expect((await f.evaluate(c)).status).toBe('review_required');
  const bounded = await f.service.candidate({ skillId: 'safe-edit', candidateId: c.candidateId, op: 'read', maxChars: 1024 });
  expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(1024);
  await expect(f.experience({ requestId: 'unc-evidence', evidence: [{ path: '\\\\untrusted-host\\private\\secret.md', revision: f.evidence.revision }] })).rejects.toThrow(/path|scope|unavailable/i);
});

test('forged evaluation documents and caller pass claims never authorize promotion', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c);
  const note = await f.fs.readNote(e.path);
  await f.externalEdit({ path: e.path, content: note.content + '\nforged proof', frontmatter: note.frontmatter, expectedRevision: note.revision });
  await expect(f.promote(c, e, { passed: true })).rejects.toThrow(/attest|changed|signature|evaluation/i);
});

test('source, evidence, candidate and profile drift invalidate auto-promotion', async () => {
  for (const target of ['source', 'evidence', 'candidate', 'profile']) {
    const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c);
    if (target === 'profile') f.host.profiles[0].revision = '2';
    else {
      const path = target === 'source' ? 'Community/Skills/safe-edit/SKILL.md' : target === 'evidence' ? f.evidence.path : c.path;
      const n = await f.fs.readNote(path);
      await f.externalEdit({ path, content: n.content + '\nchanged', frontmatter: n.frontmatter, expectedRevision: n.revision });
    }
    await expect(f.promote(c, e)).rejects.toThrow(/changed|stale|revision|attest|profile|evaluation/i);
  }
});

test('two concurrent promotions cannot both replace the same current revision', async () => {
  const f = await fixture(), a = await f.candidate(), b = await f.candidate({ requestId: 'candidate-2' });
  const ae = await f.evaluate(a), be = await f.evaluate(b);
  const args = (c: any, e: any) => ({ skillId: 'safe-edit', principal: f.owner, accessToken: f.ownerToken, candidateId: c.candidateId, evaluationId: e.evaluationId, expectedRevision: 'missing', mode: 'auto' });
  const ap = await f.service.promote({ ...args(a, ae), op: 'preview' }), bp = await f.service.promote({ ...args(b, be), op: 'preview' });
  const results = await Promise.allSettled([
    f.service.promote({ ...args(a, ae), op: 'apply', fingerprint: ap.fingerprint, requestId: 'promote-a' }),
    f.service.promote({ ...args(b, be), op: 'apply', fingerprint: bp.fingerprint, requestId: 'promote-b' }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect((await f.resolve()).status).toBe('active');
});

test('host approval accounts, not caller metadata, can approve a review-required change', async () => {
  const f = await fixture(); f.host.profiles = [];
  const c = await f.candidate(), e = await f.evaluate(c);
  await expect(f.promote(c, e, { mode: 'approved', approvedBy: 'reviewer', reason: 'Approve' })).rejects.toThrow(/approv|allowed/i);
  await f.promote(c, e, { principal: f.reviewer, accessToken: f.reviewerToken, mode: 'approved', reason: 'I reviewed this exact candidate.' });
  expect((await f.resolve()).status).toBe('active');
});

test('external current/version edits are preserved and no longer treated as evaluated', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c);
  await f.promote(c, e);
  const before = await f.resolve(), n = await f.fs.readNote(before.path);
  await f.externalEdit({ path: before.path, content: 'user edit', frontmatter: n.frontmatter, expectedRevision: n.revision });
  const after = await f.resolve();
  expect(after.status).toBe('needs_review'); expect(after.path).toBe('Community/Skills/safe-edit/SKILL.md');
  expect((await f.fs.readNote(before.path)).content).toContain('user edit');
});

test('candidate edits and rejection require revision and authenticated ownership', async () => {
  const f = await fixture(), c = await f.candidate();
  await expect(f.service.candidate({ op: 'update', skillId: 'safe-edit', candidateId: c.candidateId, principal: f.owner, accessToken: f.ownerToken,
    requestId: 'update', expectedRevision: 'stale', content: 'changed', reason: 'Revise' })).rejects.toThrow(/revision|changed/i);
  const rejected = await f.service.candidate({ op: 'reject', skillId: 'safe-edit', candidateId: c.candidateId, principal: f.owner, accessToken: f.ownerToken,
    requestId: 'reject', expectedRevision: c.revision, reason: 'Not applicable to this task.' });
  expect(rejected.state).toBe('rejected');
  await expect(f.evaluate({ ...c, revision: rejected.revision })).rejects.toThrow(/reject/i);
});

test('disabled service, unauthenticated writes and hostile IDs fail before creating data', async () => {
  const f = await fixture();
  await expect(f.experience({ principal: undefined })).rejects.toThrow(/auth/i);
  await expect(f.service.resolve({ skillId: '../safe-edit', principal: f.owner, accessToken: f.ownerToken })).rejects.toThrow(/id|path/i);
  f.host.enabled = false;
  await expect(f.experience()).rejects.toThrow(/disabled/i);
});

test('invalid response budgets fail before any skill mutation', async () => {
  const f = await fixture();
  await expect(f.experience({ maxChars: 20 })).rejects.toThrow(/maxChars|budget/i);
  expect((await f.fs.queryNotes({ pathPrefix: 'Community/Skills/safe-edit/_evolution/', limit: 10 })).notes).toHaveLength(0);
});

test('promotion retains an immutable dated decision and promoted candidates leave the pending list', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c);
  await f.promote(c, e);
  const pointer = await f.fs.readNote('Community/Skills/safe-edit/_evolution/current.md');
  const transition = pointer.frontmatter.skill_evolution.transition;
  expect(transition?.path).toContain('/transitions/');
  const event = await f.fs.readNote(transition.path);
  expect(event.frontmatter.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(event.frontmatter.skill_evolution.event).toBe('promote');
  expect(event.frontmatter.skill_evolution.evaluation.path).toBe(e.path);
  expect(await f.service.nextAction({ principal: f.owner, accessToken: f.ownerToken, skillId: 'safe-edit' })).toBeUndefined();
});

test('applicability conditions are included in the exact candidate text seen by the evaluator', async () => {
  const f = await fixture(); let seen = '';
  const originalEvaluator = f.host.profiles[0]!.evaluate;
  f.host.profiles[0]!.evaluate = async input => { seen = input.candidate; return originalEvaluator(input); };
  const c = await f.candidate({ conditions: 'Only authorized text notes, never secrets.' }); await f.evaluate(c);
  expect(seen).toContain('Only authorized text notes, never secrets.');
});

test('in-vault public-looking symlink evidence cannot smuggle private content', async () => {
  const f = await fixture();
  await f.externalEdit({ path: '_scopes/models/test/private/record.md', content: 'not for community' });
  await symlink(join(f.root, '_scopes/models/test/private'), join(f.root, 'Alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const privateNote = await f.fs.readNote('_scopes/models/test/private/record.md');
  await expect(f.experience({ evidence: [{ path: 'Alias/record.md', revision: privateNote.revision }] })).rejects.toThrow(/alias|unavailable|private/i);
});

test('a changed upstream can seed a fresh candidate and be re-evaluated without overwriting the old version', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c);
  await f.promote(c, e); const old = await f.resolve();
  const source = await f.fs.readNote('Community/Skills/safe-edit/SKILL.md');
  await f.externalEdit({ path: 'Community/Skills/safe-edit/SKILL.md', content: source.content + '\nUpdated source context.\n', frontmatter: source.frontmatter, expectedRevision: source.revision });
  const b = await f.resolve(); expect(b.status).toBe('needs_review');
  const exp = await f.experience({ requestId: 'updated-use' });
  const next = await f.service.candidate({ op: 'create', skillId: 'safe-edit', principal: f.owner, accessToken: f.ownerToken, expectedRevision: 'missing',
    requestId: 'updated-candidate', baseRevision: b.revision, expectedCurrentRevision: b.currentRevision,
    content: '# Updated procedure\nread\npatch\nverify\n', conditions: 'An authorized patch', reason: 'Adapt to updated source',
    experiences: [{ path: exp.path, revision: exp.revision }] });
  const evaluation = await f.evaluate(next); await f.promote(next, evaluation);
  expect((await f.resolve()).status).toBe('active'); expect(await f.fs.noteExists(old.path)).toBe(true);
});

test('an edited current pointer needs host approval and its exact prior bytes are preserved', async () => {
  const f = await fixture(), c = await f.candidate(), e = await f.evaluate(c); await f.promote(c, e);
  const pointerPath = 'Community/Skills/safe-edit/_evolution/current.md', old = await f.fs.readNote(pointerPath);
  await f.externalEdit({ path: pointerPath, content: old.content + '\nAuthored user annotation.\n', frontmatter: old.frontmatter, expectedRevision: old.revision });
  const edited = await f.fs.readNote(pointerPath), b = await f.resolve(), exp = await f.experience({ requestId: 'repair-use' });
  const repair = await f.service.candidate({ op: 'create', skillId: 'safe-edit', principal: f.owner, accessToken: f.ownerToken, expectedRevision: 'missing', requestId: 'repair-candidate',
    baseRevision: b.revision, expectedCurrentRevision: b.currentRevision, content: '# Procedure\nread\npatch\nverify\n', conditions: 'Authorized patch',
    reason: 'Review edited pointer', experiences: [{ path: exp.path, revision: exp.revision }] });
  const evaluation = await f.evaluate(repair);
  await expect(f.promote(repair, evaluation)).rejects.toThrow(/approv|review/i);
  await f.promote(repair, evaluation, { principal: f.reviewer, accessToken: f.reviewerToken, mode: 'approved', reason: 'Preserve annotation and replace current pointer.' });
  const now = await f.fs.readNote(pointerPath), snapshot = now.frontmatter.skill_evolution.previousPointer;
  expect((await f.fs.readNote(snapshot.path)).content).toContain(edited.originalContent.trimEnd());
});
