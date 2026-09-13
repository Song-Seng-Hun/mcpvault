import { expect, test } from 'vitest';
import { parseDocumentStructure } from './document-structure.js';
import { createBundlePlan } from './document-bundle-plan.js';
import { chapterCandidate, chapterPlanPage, type CandidateContext } from './compilation-bundle-candidates.js';
import { bundleIdentity, type CompilationBundle } from './compilation-bundle-model.js';
import { compilationHash } from './compilation-policy.js';

function fixture(raw = '# Approval\nOnly after approval. 😀\n') {
  const source = parseDocumentStructure({ path: 'Manual.md', raw });
  const id = '9cac42de-e32d-41e2-8370-df5f19d3b19c';
  const bundle: CompilationBundle = { version: 1, bundleId: bundleIdentity(source.revision), documentId: id,
    accountId: 'owner', projectId: 'p', documentPath: source.path, chapterRoot: 'Chapters', sourceRevision: source.revision,
    authority: 'a'.repeat(64), mode: 'synthesis_allowed', status: 'source_preserved', attempts: 1 };
  const values = new Map<string, unknown>(); let writes = 0, interrupt = -1, current = true;
  const plan = createBundlePlan(source, { documentId: bundle.documentId, bundleId: bundle.bundleId, chapterRoot: bundle.chapterRoot, ruleVersion: 'v1' });
  const ctx: CandidateContext = { bundle, source, plan, jobRevision: 'b'.repeat(64),
    assertCurrent: async () => { if (!current) throw Error('revoked'); },
    assertReferences: paths => { if (paths.includes('Hidden.md')) throw Error('hidden'); },
    reserveCandidate: () => {}, // Pure receipt tests; real service owns the process-wide budget.
    acquire: async () => ({ assertHeld: async () => {}, close: async () => {} }),
    records: { read: async id => ({ revision: values.has(id) ? compilationHash(values.get(id)) : 'missing', value: structuredClone(values.get(id)) }),
      write: async (id, value, expected, guard) => {
        expect(expected).toBe(values.has(id) ? compilationHash(values.get(id)) : 'missing');
        await guard?.(); values.set(id, structuredClone(value));
        if (++writes === interrupt) throw Error('interrupted');
        return { revision: compilationHash(value) };
      } },
  };
  const args = { op: 'submit', chapterId: plan.items[0]?.chapterId, expectedPlanRevision: plan.revision, requestId: 'one',
    metadata: { title: 'Approval', description: 'Approval condition.', kind: 'manual', domain: 'software',
      useWhen: 'Deploying.', avoidWhen: 'Read only.', stage: 'execute', aliases: ['승인'], prerequisites: [], tools: [], counterexamples: [] },
    content: 'Only after approval. 😀\nExample: read the rule before deployment.\n' };
  return { ctx, args, values, writes: () => writes, interruptAt: (n: number) => { interrupt = n; }, revoke: () => { current = false; } };
}
test.each([1, 2, 3, 4, 5])('interruption after save%d resumes and complete replay causes no write', async cut => {
  const f = fixture(); f.interruptAt(cut);
  await expect(chapterCandidate(f.ctx, f.args)).rejects.toThrow('interrupted');
  f.interruptAt(-1);
  const result = await chapterCandidate({ ...f.ctx }, f.args);
  expect(result.status).toBe('candidate_stored');
  const writes = f.writes(); expect(await chapterCandidate(f.ctx, f.args)).toEqual(result); expect(f.writes()).toBe(writes);
});
test('every body has a durable authority header and request before its first write', async () => {
  const f = fixture(), write = f.ctx.records.write;
  f.ctx.records.write = async (id, value: any, revision, guard) => {
    if (value.rendered !== undefined) {
      expect([...f.values.values()].some((v: any) => v.status === 'prepared' && v.authority === f.ctx.bundle.authority)).toBe(true);
      expect([...f.values.values()].some((v: any) => v.payloadHash && v.status === undefined)).toBe(true);
    }
    return write(id, value, revision, guard);
  };
  await chapterCandidate(f.ctx, f.args);
});
test('lost or modified history is preserved and never silently regenerated', async () => {
  for (const kind of ['header', 'request', 'body', 'receipt', 'modified-body']) {
    const f = fixture(); await chapterCandidate(f.ctx, f.args);
    const target = [...f.values.entries()].find(([, v]: any) => kind === 'header' ? v.status === 'stored'
      : kind === 'request' ? v.payloadHash && v.status === undefined : kind === 'receipt' ? v.bodyRevision !== undefined : v.rendered !== undefined)!;
    if (kind === 'modified-body') f.values.set(target[0], { ...(target[1] as object), rendered: 'user edited' }); else f.values.delete(target[0]);
    const before = structuredClone([...f.values]);
    await expect(chapterCandidate(f.ctx, f.args)).rejects.toThrow(); expect([...f.values]).toEqual(before);
  }
});
test('revocation and repeated failures stop writes; changes require review', async () => {
  const f = fixture();
  for (let i = 1; i <= 3; i++) { f.interruptAt(i); await expect(chapterCandidate(f.ctx, f.args)).rejects.toThrow(); }
  f.interruptAt(-1); expect(await chapterCandidate(f.ctx, f.args)).toMatchObject({ status: 'review_required', reason: 'attempt_limit' });
  const g = fixture(); await chapterCandidate(g.ctx, g.args); const before = g.writes();
  expect(await chapterCandidate(g.ctx, { ...g.args, requestId: 'two', content: 'Changed.' })).toMatchObject({ reason: 'candidate_conflict' });
  g.revoke(); await expect(chapterCandidate(g.ctx, g.args)).rejects.toThrow(); expect(g.writes()).toBe(before);
});
test.each([1024, 1600, 4000, 12000])('candidate exact reads use whole JSON budget%d and UTF16-safe continuations', async maxChars => {
  const f = fixture(); f.args.content = 'Keep approval. 😀 '.repeat(9) + '\n';
  const result = await chapterCandidate(f.ctx, f.args);
  let args: any = { op: 'read', chapterId: f.args.chapterId, expectedPlanRevision: f.ctx.plan.revision,
    expectedCandidateRevision: result.candidateRevision, maxChars }, text = '';
  for (let i = 0; i < 20; i++) {
    const page = await chapterCandidate(f.ctx, args); expect(JSON.stringify(page).length).toBeLessThanOrEqual(maxChars);
    expect(page.part.text).not.toMatch(/[\ud800-\udbff]$/); text += page.part.text;
    if (!page.nextAction) break; args = page.nextAction.arguments;
  }
  expect(text).toBe(([...f.values.values()].find((v: any) => v.rendered) as any).rendered);
  await expect(chapterCandidate(f.ctx, { ...args, expectedCandidateRevision: '0'.repeat(64) })).rejects.toThrow();
});
test('revocation before body persistence retains header, never body; hidden references are rejected', async () => {
  const f = fixture(), write = f.ctx.records.write;
  f.ctx.records.write = async (id, value: any, revision, guard) => {
    if (value.rendered !== undefined) f.revoke();
    return write(id, value, revision, guard);
  };
  await expect(chapterCandidate(f.ctx, f.args)).rejects.toThrow('revoked');
  expect([...f.values.values()].some((v: any) => v.rendered !== undefined)).toBe(false);
  const g = fixture();
  await expect(chapterCandidate(g.ctx, { ...g.args, metadata: { ...g.args.metadata, prerequisites: ['Hidden.md'] } })).rejects.toThrow();
  expect(g.writes()).toBe(0);
  const h = fixture(); h.ctx.reserveCandidate = () => { throw Error('memory'); };
  await expect(chapterCandidate(h.ctx, h.args)).rejects.toThrow('memory'); expect(h.writes()).toBe(0);
});
test('plan pages are bounded and a stale continuation cannot reuse a cursor', () => {
  const f = fixture(Array.from({ length: 20 }, (_, i) => `# Section${i}\nKeep condition${i}.\n\n`).join(''));
  let args: any = { maxChars: 1600 }, ids: string[] = [];
  for (let i = 0; i < 30; i++) {
    const page = chapterPlanPage(f.ctx, args); expect(JSON.stringify(page).length).toBeLessThanOrEqual(1600);
    ids.push(...page.items.map((item: any) => item.chapterId)); if (!page.nextAction) break; args = page.nextAction.arguments;
  }
  expect(ids).toEqual(f.ctx.plan.items.map(i => i.chapterId));
  expect(() => chapterPlanPage(f.ctx, { ...args, chapterCursor: 1, expectedPlanRevision: '0'.repeat(64) })).toThrow();
});
