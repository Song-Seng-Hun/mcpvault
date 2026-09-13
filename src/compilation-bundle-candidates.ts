import { guidanceError } from './guidance-runtime.js';
import { createHash } from 'node:crypto';
import type { CompilationBundle } from './compilation-bundle-model.js';
import { compilationHash } from './compilation-policy.js';
import { compilationId } from './compilation-model.js';
import type { HostWorkRecords, HostWorkWriter } from './host-work-storage.js';
import type { DocumentStructure } from './document-structure.js';
import type { BundleChapterPlan } from './document-bundle-plan.js';
import { renderManagedChapter, type ManagedChapterMetadata } from './document-chapter-format.js';

const invalid = () => guidanceError(new Error('Chapter candidate unavailable'), 'guid-7026a2d6e6ee973e');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export interface CandidateContext {
  bundle: CompilationBundle; source: DocumentStructure; plan: BundleChapterPlan; jobRevision: string;
  records: HostWorkRecords; acquire(): Promise<HostWorkWriter>; assertCurrent(): Promise<void>;
  assertReferences(paths: string[]): void;
  reserveCandidate(raw: string): void;
}
const editable = ['title', 'description', 'kind', 'domain', 'useWhen', 'avoidWhen', 'stage', 'aliases', 'prerequisites', 'tools', 'counterexamples'];
function render(ctx: CandidateContext, chapterId: string, metadata: Record<string, any>, content: string) {
  const item = ctx.plan.items.find(c => c.chapterId === chapterId);
  if (!item || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || Object.keys(metadata).some(k => !editable.includes(k)) || editable.some(k => !Object.hasOwn(metadata, k))) throw invalid();
  if (typeof content !== 'string' || content.length > 24000) throw invalid();
  ctx.reserveCandidate(content);
  const fields: ManagedChapterMetadata = { ...metadata as Pick<ManagedChapterMetadata, typeof editable[number] & keyof ManagedChapterMetadata>,
    documentId: ctx.bundle.documentId, bundleId: ctx.bundle.bundleId, chapterId,
    parent: item.parent, position: item.position, total: ctx.plan.items.length,
    ...(item.previous && { previous: item.previous }), ...(item.next && { next: item.next }), project: ctx.bundle.projectId,
    sourceFamily: ctx.bundle.documentId, sourceRevision: ctx.bundle.sourceRevision, ruleVersion: ctx.plan.rule,
    sourceRanges: [{ startOffset: item.startOffset, endOffset: item.endOffset }] } as ManagedChapterMetadata;
  const result = renderManagedChapter(ctx.source, fields, content);
  ctx.assertReferences([item.path, ...fields.prerequisites, ...fields.counterexamples]);
  return result;
}
export function chapterPlanPage(ctx: CandidateContext, params: Record<string, any>) {
  const cursor = params.chapterCursor ?? 0, maxChars = params.maxChars ?? 4000;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > ctx.plan.items.length
    || cursor > 0 && params.expectedPlanRevision !== ctx.plan.revision
    || params.expectedPlanRevision !== undefined && params.expectedPlanRevision !== ctx.plan.revision) throw invalid();
  const items: Record<string, unknown>[] = [];
  const page = (next: number, budget = maxChars) => ({ bundleId: ctx.bundle.bundleId, planRevision: ctx.plan.revision,
    sourceRevision: ctx.bundle.sourceRevision, items, partial: next < ctx.plan.items.length, automaticApplication: false,
    ...(next < ctx.plan.items.length && { nextAction: { endpointId: 'wiki.compilation', arguments: {
      kind: 'document_bundle', op: 'read', projection: 'plan', bundleId: ctx.bundle.bundleId,
      expectedJobRevision: ctx.jobRevision, expectedPlanRevision: ctx.plan.revision, chapterCursor: next, maxChars: budget } } }) });
  let end = cursor;
  while (end < ctx.plan.items.length && items.length < 8) {
    const item = ctx.plan.items[end]!;
    items.push({ chapterId: item.chapterId, description: item.description, kind: item.kind, identity: item.identity,
      startOffset: item.startOffset, endOffset: item.endOffset, position: item.position,
      readAction: { endpointId: 'wiki.compilation', arguments: { kind: 'document_bundle', op: 'read', projection: 'original',
        bundleId: ctx.bundle.bundleId, expectedJobRevision: ctx.jobRevision, startOffset: item.startOffset, endOffset: item.endOffset, maxChars: 2000 } } });
    if (JSON.stringify(page(end + 1)).length > maxChars) { items.pop(); break; }
    end++;
  }
  const result = page(end, items.length ? maxChars : 4000);
  if (JSON.stringify(result).length > maxChars) throw invalid();
  return result;
}

/** Private, per-chapter receipts. No model, Vault write, semantic pass or publication.
 * Parent service owns current ACL/runtime/source checks, including every return. */
export async function chapterCandidate(ctx: CandidateContext, params: Record<string, any>): Promise<any> {
  const { bundle, plan, records } = ctx, chapterId = params.chapterId;
  if (bundle.mode !== 'synthesis_allowed' || params.expectedPlanRevision !== plan.revision
    || !plan.items.some(c => c.chapterId === chapterId)) throw invalid();
  const id = (kind: string) => compilationHash({ kind: `chapter-candidate-${kind}-v1`, bundleId: bundle.bundleId, chapterId });
  const headerId = id('header'), bodyId = id('body'), receiptId = id('receipt');
  const base = { version: 1, bundleId: bundle.bundleId, chapterId, accountId: bundle.accountId,
    authority: bundle.authority, sourceRevision: bundle.sourceRevision, planRevision: plan.revision };
  const read = async () => ({ header: await records.read(headerId), body: await records.read(bodyId), receipt: await records.read(receiptId) });
  let state = await read();
  const validate = () => {
    const h = state.header.value as any;
    if (h === undefined) { if (state.body.value !== undefined || state.receipt.value !== undefined) throw invalid(); return; }
    if (!h || Object.keys(h).sort().join(',') !== [...Object.keys(base), 'payloadHash', 'requestKey', 'status', 'attempts'].sort().join(',')
      || Object.keys(base).some(k => h[k] !== (base as any)[k]) || !/^[a-f0-9]{64}$/.test(h.payloadHash)
      || !/^[a-f0-9]{64}$/.test(h.requestKey) || !['prepared', 'stored'].includes(h.status)
      || !Number.isSafeInteger(h.attempts) || h.attempts < 1 || h.attempts > 3) throw invalid();
    if (state.body.value !== undefined) {
      const b = state.body.value as any;
      if (!b || Object.keys(b).sort().join(',') !== 'content,metadata,rendered' || compilationHash({ metadata: b.metadata, content: b.content }) !== h.payloadHash
        || render(ctx, chapterId, b.metadata, b.content).content !== b.rendered) throw invalid();
    }
    if (state.receipt.value !== undefined && (state.body.value === undefined || compilationHash(state.receipt.value) !== compilationHash({
      version: 1, headerBasis: compilationHash({ ...base, payloadHash: h.payloadHash, requestKey: h.requestKey }),
      bodyRevision: state.body.revision, renderedHash: digest((state.body.value as any).rendered) }))) throw invalid();
    if (h.status === 'stored' && (state.body.value === undefined || state.receipt.value === undefined)) throw invalid();
  };
  validate();
  if (params.op === 'submit') {
    if (!compilationId(params.requestId)) throw invalid();
    const rendered = render(ctx, chapterId, params.metadata, params.content).content;
    const payloadHash = compilationHash({ metadata: params.metadata, content: params.content });
    const requestKey = compilationHash({ kind: 'document-bundle-request-v1', accountId: bundle.accountId, requestId: params.requestId });
    const requestValue = { version: 1, bundleId: bundle.bundleId, chapterId, planRevision: plan.revision, payloadHash };
    const writer = await ctx.acquire();
    try {
      state = await read(); validate(); await ctx.assertCurrent(); await writer.assertHeld();
      const request = await records.read(requestKey);
      if (request.value !== undefined && compilationHash(request.value) !== compilationHash(requestValue)) throw invalid();
      let header = state.header.value as any;
      if (header === undefined && request.value !== undefined) throw invalid();
      if (header && (header.payloadHash !== payloadHash || header.requestKey !== requestKey))
        return { status: 'review_required', reason: 'candidate_conflict', automaticApplication: false };
      if (header?.status === 'stored' && request.value === undefined) throw invalid();
      if (header?.status !== 'stored') {
        if ((header?.attempts ?? 0) >= 3) return { status: 'review_required', reason: 'attempt_limit', automaticApplication: false };
        const guard = async () => { await ctx.assertCurrent(); await writer.assertHeld(); };
        header = { ...base, payloadHash, requestKey, status: 'prepared', attempts: (header?.attempts ?? 0) + 1 };
        await records.write(headerId, header, state.header.revision, guard);
        if (request.value === undefined) await records.write(requestKey, requestValue, request.revision, guard);
        // The durable header/request binds source, authority and plan before any body.
        if (state.body.value === undefined) await records.write(bodyId, { metadata: params.metadata, content: params.content, rendered }, state.body.revision, guard);
        state = await read(); validate(); await guard();
        if (state.receipt.value === undefined) await records.write(receiptId, { version: 1,
          headerBasis: compilationHash({ ...base, payloadHash, requestKey }), bodyRevision: state.body.revision,
          renderedHash: digest(rendered) }, state.receipt.revision, guard);
        state = await read(); validate(); await guard();
        await records.write(headerId, { ...header, status: 'stored' }, state.header.revision, guard);
        state = await read(); validate();
      }
      const currentRequest = await records.read(requestKey);
      if (compilationHash(currentRequest.value) !== compilationHash(requestValue)) throw invalid();
    } finally { await writer.close(); }
  }
  if ((state.header.value as any)?.status !== 'stored') return { status: 'candidate_pending', partial: true, automaticApplication: false };
  const header = state.header.value as any;
  const boundRequest = await records.read(header.requestKey);
  if (compilationHash(boundRequest.value) !== compilationHash({ version: 1, bundleId: bundle.bundleId, chapterId,
    planRevision: plan.revision, payloadHash: header.payloadHash })) throw invalid();
  let response: any = { status: 'candidate_stored', chapterId, candidateRevision: state.body.revision,
    planRevision: plan.revision, semantic: 'not_assessed', automaticApplication: false };
  if (params.op === 'read') {
    if (params.expectedCandidateRevision !== state.body.revision) throw invalid();
    const text = (state.body.value as any).rendered as string, start = params.startOffset ?? 0, maxChars = params.maxChars ?? 4000;
    if (!Number.isSafeInteger(start) || start < 0 || start > text.length
      || start > 0 && /[\ud800-\udbff]/.test(text[start - 1]!) && /[\udc00-\udfff]/.test(text[start] ?? '')) throw invalid();
    const page = (end: number) => ({ ...response, part: { startOffset: start, endOffset: end, text: text.slice(start, end) }, partial: end < text.length,
      ...(end < text.length && { nextAction: { endpointId: 'wiki.compilation', arguments: { kind: 'document_bundle', op: 'read', projection: 'candidate',
        bundleId: bundle.bundleId, chapterId, expectedJobRevision: ctx.jobRevision, expectedPlanRevision: plan.revision,
        expectedCandidateRevision: state.body.revision, startOffset: end, maxChars } } }) });
    let low = start, high = Math.min(text.length, start + maxChars);
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (JSON.stringify(page(mid)).length <= maxChars) low = mid; else high = mid - 1; }
    if (low > start && low < text.length && /[\ud800-\udbff]/.test(text[low - 1]!) && /[\udc00-\udfff]/.test(text[low]!)) low--;
    if (low === start && start < text.length) throw invalid(); response = page(low);
  }
  const fresh = await read();
  if (fresh.header.revision !== state.header.revision || fresh.body.revision !== state.body.revision || fresh.receipt.revision !== state.receipt.revision) throw invalid();
  if ((await records.read(header.requestKey)).revision !== boundRequest.revision) throw invalid();
  await ctx.assertCurrent();
  return response;
}
