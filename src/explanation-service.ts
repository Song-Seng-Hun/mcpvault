import { guidanceError, guidanceText } from './guidance-runtime.js';
import { posix } from 'node:path';
import type { FileSystemService } from './filesystem.js';
import { FrontmatterHandler } from './frontmatter.js';
import type { ScopeAccessPolicy } from './scope-access.js';
import type { ScopePrincipal } from './scope-auth.js';
import type { WorkExecutionProfile } from './work-staffing.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, fingerprint, page, textField } from './work-model.js';
import { explanationKey, explanationApproval, explanationProfileFingerprint, validateExplanationDraft, validateExplanationReview, verifiedExplanationProfile,
  type ExplanationSource, type ExplanationDraft, type ExplanationReview } from './explanation-model.js';

export interface ExplanationSourceConfig { path: string; language?: string; audience?: string }
export interface ExplanationOptions {
  sources: ExplanationSourceConfig[];
  executionProfiles: () => Promise<WorkExecutionProfile[]>;
  assertActor: (principal: ScopePrincipal) => Promise<void>;
  accountAvailable?: (accountId: string) => Promise<boolean>;
  /** Includes Work/ordinary tasks; this service separately checks its own claims. */
  canTakeWork?: (principal: ScopePrincipal) => Promise<boolean>;
}
interface RecordState {
  version: 1; id: string; sourcePath: string; sourceRevision: string; language: string; audience: string;
  author: string; status: 'claimed' | 'draft' | 'approved' | 'changes_requested' | 'released';
  draft?: ExplanationDraft; draftFingerprint?: string; authorProfileFingerprint?: string;
  review?: { reviewer: string; draftFingerprint: string; reviewerProfileFingerprint?: string; review: ExplanationReview };
  receipts: Array<{ key: string; payload: string }>;
}
export interface ExplanationParams {
  sourcePath?: string; expectedSourceRevision?: string; expectedRevision?: string; requestId?: string;
  draft?: unknown; review?: unknown; cursor?: string; limit?: number; maxChars?: number;
}
const unavailable = () => guidanceError(Error('Explanation source unavailable'), 'guid-599da163ef09f089');
const canonicalPath = (path: string) => {
  if (typeof path !== 'string' || !path || path.length > 500 || /[\\:\x00-\x1f]/.test(path) || path.startsWith('/') || posix.normalize(path) !== path
    || path.split('/').some(p => !p || p === '..' || /[. ]$/.test(p)) || !path.endsWith('.md') || path.startsWith('_whispers/')) throw unavailable();
  return path;
};
const recordPath = (id: string) => `_whispers/explanations/${id}.md`;
const RECORD_MAX_BYTES = 180_000;
function snapshot(value: RecordState): string {
  const blocks = value.draft?.blocks.map((b, index) => `## ${b.example ? 'Example' : 'Explanation'} ${index + 1}\n\n${b.text}\n\nSource lines: ${b.startLine}-${b.endLine}.`).join('\n\n') ?? 'No draft submitted.';
  return `# Explanation snapshot\n\nPrivate managed work record, not automatically current guidance.\nUse explanations.read to recheck current source revision, access and review authority.\n\nSource: [[${value.sourcePath}]]\nSource revision: ${value.sourceRevision}\nStatus at write: ${value.status}\n\n${blocks}\n\n## Review\n\n${value.review?.review.checks.map(c => `- ${c.criterion}: ${c.verdict}. ${c.reason}`).join('\n') ?? 'Independent review pending.'}\n`;
}
export function validateExplanationSources(sources: ExplanationSourceConfig[]): ExplanationSourceConfig[] {
  if (!Array.isArray(sources) || sources.length > 64) throw guidanceError(Error('At most 64 explicitly configured explanation sources'), 'guid-0d919996ac2c7773');
  const result = sources.map(c => {
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !['path', 'language', 'audience'].includes(k))) throw guidanceError(Error('Invalid explanation source configuration'), 'guid-51c82ece4fb82ba3');
    return { path: canonicalPath(c.path), language: textField(c.language ?? 'ko', 'language', 32, true), audience: textField(c.audience ?? 'beginner', 'audience', 80, true) };
  });
  if (new Set(result.map(c => c.path.toLowerCase())).size !== result.length) throw guidanceError(Error('Duplicate explanation source'), 'guid-d200ca8b355bafb1');
  return result;
}

/** Managed private Markdown is the job/verification record. Public text is served
 * only after current-source and current-reviewer checks, never from a stale cache.
 * No model invocation, background queue worker or implicit source discovery.
 */
export class ExplanationService {
  private readonly sources: ExplanationSourceConfig[];
  constructor(private readonly fs: FileSystemService, private readonly access: ScopeAccessPolicy, private readonly options: ExplanationOptions) {
    this.sources = validateExplanationSources(options.sources);
  }
  private external(path: string): string {
    return this.access.toPublicPath(path);
  }
  private config(input: unknown, principal?: ScopePrincipal): ExplanationSourceConfig {
    let path: string;
    try { path = canonicalPath(this.access.resolveExternalPath(String(input ?? ''), principal)); } catch { throw unavailable(); }
    const config = this.sources.find(c => c.path === path);
    if (!config || !this.access.canAccessPhysicalPath(path, principal)) throw unavailable();
    return config;
  }
  private async source(config: ExplanationSourceConfig, principal?: ScopePrincipal): Promise<ExplanationSource> {
    if (!this.access.canAccessPhysicalPath(config.path, principal)) throw unavailable();
    try {
      const note = await this.fs.readNote(config.path, 256_000);
      if (isModerationHidden(note.frontmatter) || note.frontmatter.content_status === 'deleted' || note.frontmatter.mcpvault_type === 'explanation_projection') throw unavailable();
      const source = { path: config.path, revision: note.revision, content: note.content };
      explanationKey(source, config.language, config.audience);
      return source;
    } catch { throw unavailable(); }
  }
  private async actor(principal?: ScopePrincipal): Promise<ScopePrincipal> {
    if (!principal || !principal.capabilities?.includes('task')) throw guidanceError(Error('Authenticated task account required'), 'guid-fb642f2fbb25fa06');
    await this.options.assertActor(principal);
    await this.options.executionProfiles(); // Revalidates the running host-policy binding, including disable/removal.
    return principal;
  }
  private async record(source: ExplanationSource, config: ExplanationSourceConfig) {
    const id = explanationKey(source, config.language, config.audience), path = recordPath(id);
    if (!await this.fs.noteExists(path)) return { id, path, revision: 'missing', value: undefined as RecordState | undefined };
    const note = await this.fs.readNote(path, RECORD_MAX_BYTES), value = note.frontmatter.explanation as RecordState;
    if (note.frontmatter.mcpvault_type !== 'explanation_job' || !value || value.version !== 1 || value.id !== id || value.sourcePath !== source.path || value.sourceRevision !== source.revision
      || value.language !== config.language || value.audience !== config.audience || !['claimed', 'draft', 'approved', 'changes_requested', 'released'].includes(value.status)
      || typeof value.author !== 'string' || !Array.isArray(value.receipts) || value.receipts.length > 128
      || value.receipts.some(r => !r || !/^[a-f0-9]{64}$/.test(r.key) || !/^[a-f0-9]{64}$/.test(r.payload))) throw guidanceError(Error('Explanation record integrity unavailable'), 'guid-d00d3ac7da8081e1');
    if (value.draft) {
      value.draft = validateExplanationDraft(value.draft, source);
      if (value.draftFingerprint !== fingerprint(value.draft)) throw guidanceError(Error('Explanation draft changed'), 'guid-24d6479b15a34364');
    }
    if (value.review) {
      if (!value.draft || value.review.draftFingerprint !== value.draftFingerprint) throw guidanceError(Error('Explanation review basis changed'), 'guid-96478f80cb1ec3a7');
      value.review.review = validateExplanationReview(value.review.review, value.draft.blocks.length);
    }
    if ((['draft', 'approved', 'changes_requested'].includes(value.status) && !value.draft) || (value.status === 'approved' && !value.review)) throw guidanceError(Error('Explanation record incomplete'), 'guid-365150c1b58e0c2b');
    return { id, path, revision: note.revision, value };
  }
  private async approved(record: RecordState | undefined, source: ExplanationSource): Promise<boolean> {
    if (record?.status !== 'approved' || !record.review || !record.draft) return false;
    if (this.options.accountAvailable && (!await this.options.accountAvailable(record.author) || !await this.options.accountAvailable(record.review.reviewer))) return false;
    const profiles = await this.options.executionProfiles();
    if (!record.authorProfileFingerprint || record.authorProfileFingerprint !== explanationProfileFingerprint(profiles, record.author)
      || !record.review.reviewerProfileFingerprint || record.review.reviewerProfileFingerprint !== explanationProfileFingerprint(profiles, record.review.reviewer)) return false;
    return explanationApproval({ sourceRevision: record.sourceRevision, currentRevision: source.revision, author: record.author,
      reviewer: record.review.reviewer, profiles, review: record.review.review }).approved;
  }
  private async fresh(source: ExplanationSource, config: ExplanationSourceConfig, revision: string, principal?: ScopePrincipal): Promise<void> {
    if (principal) await this.actor(principal);
    else await this.options.executionProfiles();
    const current = await this.source(config, principal);
    if (current.revision !== source.revision || (await this.record(current, config)).revision !== revision) throw guidanceError(Error('Explanation context changed; read again'), 'guid-6191b36446503b4f');
  }
  private async hasOwnWork(principal: ScopePrincipal, except?: string): Promise<boolean> {
    for (const config of this.sources) {
      if (config.path === except || !this.access.canAccessPhysicalPath(config.path, principal)) continue;
      let source: ExplanationSource;
      try { source = await this.source(config, principal); } catch { continue; }
      const value = (await this.record(source, config)).value;
      if (value?.author === principal.accountId && (['claimed', 'draft', 'changes_requested'].includes(value.status)
        || value.status === 'approved' && !await this.approved(value, source))) return true;
    }
    return false;
  }
  /** Cover all awaits in a derived read. Revision rereads catch external edits;
   * synchronous service notifications close the gaps between those rereads.
   * This is not a cross-process filesystem snapshot/transaction guarantee. */
  private async observedRead<T>(principal: ScopePrincipal | undefined, operation: (visible: Set<string>) => Promise<T>): Promise<T> {
    const sourceIds = new Set(this.sources.map(c => this.fs.noteChangeIdentity(c.path)));
    const recordRoot = this.fs.noteChangeIdentity('_whispers/explanations/marker.md').slice(0, -'marker.md'.length);
    const visible = new Set<string>(); let changed = false;
    const dispose = this.fs.observeNoteChanges(path => {
      const id = this.fs.noteChangeIdentity(path);
      if (sourceIds.has(id) || id.startsWith(recordRoot)) changed = true;
    });
    try {
      const result = await operation(visible);
      if (changed) throw guidanceError(Error('Explanation context changed during read; retry'), 'guid-2dafe7e39718e2c1');
      // No await after this final ACL barrier and before releasing the observer.
      for (const path of visible) if (!this.access.canAccessPhysicalPath(path, principal)) throw unavailable();
      return result;
    } finally { dispose(); }
  }
  async execute(op: string, params: ExplanationParams, principal?: ScopePrincipal): Promise<Record<string, any>> {
    if (op === 'read' || op === 'list') return this.observedRead(principal, visible => this.executeInternal(op, params, principal, visible));
    return this.executeInternal(op, params, principal);
  }
  private async executeInternal(op: string, params: ExplanationParams, principal?: ScopePrincipal, visible?: Set<string>): Promise<Record<string, any>> {
    await this.options.executionProfiles();
    if (op === 'list') {
      const actor = await this.actor(principal), items: Record<string, unknown>[] = [];
      const checks: Array<{ config: ExplanationSourceConfig; source: ExplanationSource; revision: string; value: RecordState | undefined; approved: boolean }> = [];
      for (const config of this.sources) {
        if (!this.access.canAccessPhysicalPath(config.path, actor)) continue;
        let source: ExplanationSource;
        try { source = await this.source(config, actor); } catch { continue; }
        const record = await this.record(source, config);
        const approved = await this.approved(record.value, source);
        await this.fresh(source, config, record.revision, actor);
        visible?.add(config.path);
        checks.push({ config, source, revision: record.revision, value: record.value, approved });
        items.push({ id: record.id, sourcePath: this.external(source.path), sourceRevision: source.revision, revision: record.revision,
          status: approved ? 'approved' : record.value?.status === 'approved' ? 'review_required' : record.value?.status ?? 'queued',
          language: config.language, audience: config.audience });
      }
      // Validate the complete inventory, not only the page: totals and cursors
      // must not preserve a source hidden while a later source was being read.
      for (const check of checks) {
        await this.fresh(check.source, check.config, check.revision, actor);
        if (await this.approved(check.value, check.source) !== check.approved) throw guidanceError(Error('Explanation review authority changed'), 'guid-0eca92cf4f67980c');
      }
      await this.actor(actor);
      return page(items, { advisory: true, modelCalls: false }, fingerprint(items), params, 'explanations.list');
    }
    const config = this.config(params.sourcePath, principal), source = await this.source(config, principal);
    if (params.expectedSourceRevision !== undefined && params.expectedSourceRevision !== source.revision) throw guidanceError(Error('Explanation source changed; restart the job'), 'guid-d7e4afe9c79aa587');
    if (op === 'read') {
      visible?.add(config.path);
      const record = await this.record(source, config), approved = await this.approved(record.value, source);
      if (params.expectedRevision !== undefined && params.expectedRevision !== record.revision) throw guidanceError(Error('Explanation revision changed'), 'guid-41a346eababd1e3c');
      let canReadDraft = false;
      let profiles: WorkExecutionProfile[] = [];
      if (principal) {
        await this.actor(principal);
        profiles = await this.options.executionProfiles();
        const profile = verifiedExplanationProfile(profiles, principal.accountId);
        canReadDraft = Boolean(profile);
      }
      const items = approved || canReadDraft ? record.value?.draft?.blocks ?? [] : [];
      const status = !approved && record.value?.status === 'approved' ? 'review_required' : record.value?.status ?? 'queued';
      const authorBasisCurrent = Boolean(record.value?.authorProfileFingerprint && record.value.authorProfileFingerprint === explanationProfileFingerprint(profiles, record.value.author));
      let operation = !canReadDraft || approved ? undefined : ['queued', 'released'].includes(status) ? 'claim'
        : record.value?.author === principal?.accountId && (['claimed', 'changes_requested', 'review_required'].includes(status) || status === 'draft' && !authorBasisCurrent) ? 'draft'
        : record.value?.author !== principal?.accountId && authorBasisCurrent && ['draft', 'changes_requested', 'review_required'].includes(status) ? 'review' : undefined;
      if (operation === 'review' && explanationApproval({ sourceRevision: source.revision, currentRevision: source.revision, author: record.value!.author,
        reviewer: principal!.accountId, profiles, review: { checks: [] } }).reason === 'independent_verified_family_required') operation = undefined;
      if (operation === 'claim' && ((this.options.canTakeWork && !await this.options.canTakeWork(principal!)) || await this.hasOwnWork(principal!))) operation = undefined;
      const response = page(items, { id: record.id, revision: record.revision, sourcePath: this.external(source.path), sourceRevision: source.revision,
        status: approved ? 'approved' : record.value?.status === 'approved' ? 'review_required' : record.value?.status ?? 'queued',
        language: config.language, audience: config.audience,
        route: { kind: approved ? 'verified_explanation' : 'original_source', skipped: approved ? ['generation', 'review'] : [], authority: 'source_revision_and_review' },
        sourceAction: { endpointId: 'notes.read', arguments: { path: this.external(source.path), expectedRevision: source.revision, maxChars: 4000 } },
        ...(operation && { nextAction: { endpointId: `explanations.${operation}`, arguments: { sourcePath: this.external(source.path), expectedSourceRevision: source.revision, expectedRevision: record.revision }, requiredInput: ['requestId', ...(operation === 'draft' ? ['draft'] : operation === 'review' ? ['review'] : [])], voluntary: true } }),
        warning: guidanceText('guid-5209886a2b2e43fe', 'An explanation is derived guidance, not evidence that the original is factually true.') }, fingerprint({ source: source.revision, record: record.revision, approved, canReadDraft }), params, 'explanations.read');
      await this.fresh(source, config, record.revision, principal);
      if (approved && !await this.approved(record.value, source)) throw guidanceError(Error('Explanation review authority changed'), 'guid-0eca92cf4f67980c');
      return response;
    }
    if (!['claim', 'release', 'draft', 'review'].includes(op)) throw guidanceError(Error('Unknown explanation operation'), 'guid-ae3d9af6be80b0ed');
    const actor = await this.actor(principal);
    if (op === 'claim' && !verifiedExplanationProfile(await this.options.executionProfiles(), actor.accountId)) throw guidanceError(Error('Host-verified profile required to claim explanation work'), 'guid-9fb374d40f180a4b');
    textField(params.requestId, 'requestId', 128, true);
    if (!params.expectedRevision || !params.expectedSourceRevision) throw guidanceError(Error('Exact source and job revisions required'), 'guid-76b5caa102b3d369');
    return coordinate(async () => {
      const record = await this.record(source, config), existing = record.value;
      await this.fresh(source, config, record.revision, actor);
      const key = fingerprint({ actor: actor.accountId, requestId: params.requestId });
      const payload = fingerprint({ op, params });
      const retry = existing?.receipts.find(r => r.key === key);
      if (retry) {
        if (retry.payload !== payload) throw guidanceError(Error('Explanation requestId reused with different content'), 'guid-283ed9fec9b69608');
        return { id: record.id, revision: record.revision, sourceRevision: source.revision, status: existing!.status, replayed: true };
      }
      if (record.revision !== params.expectedRevision) throw guidanceError(Error('Explanation revision conflict'), 'guid-5765deaad4ec8546');
      if (existing && existing.receipts.length >= 128) throw guidanceError(Error('Explanation history capacity reached'), 'guid-68118cdc702ac7ef');
      const value: RecordState = structuredClone(existing ?? { version: 1, id: record.id, sourcePath: source.path, sourceRevision: source.revision,
        language: config.language!, audience: config.audience!, author: actor.accountId, status: 'claimed', receipts: [] });
      const stillApproved = value.status === 'approved' && await this.approved(value, source);
      if (op === 'claim') {
        if (existing && existing.status !== 'released') throw guidanceError(Error('Explanation job already claimed'), 'guid-7e79da72e3e65232');
        if (this.options.canTakeWork && !await this.options.canTakeWork(actor)) throw guidanceError(Error('Work in progress limit reached'), 'guid-3b49f711da486220');
        if (await this.hasOwnWork(actor, config.path)) throw guidanceError(Error('Explanation WIP limit reached'), 'guid-110f84fb8e3b5a91');
        value.author = actor.accountId; value.status = 'claimed'; delete value.draft; delete value.draftFingerprint; delete value.authorProfileFingerprint; delete value.review;
      } else {
        if (!existing || existing.status === 'released') throw guidanceError(Error('Claim the explanation job first'), 'guid-f51c1564999c99bb');
        if (op === 'review') {
          if (!value.draft || stillApproved || !['draft', 'changes_requested', 'approved'].includes(value.status)) throw guidanceError(Error('A submitted explanation draft is required'), 'guid-56f85b0b3d9f26fe');
          const profiles = await this.options.executionProfiles();
          if (!value.authorProfileFingerprint || value.authorProfileFingerprint !== explanationProfileFingerprint(profiles, value.author)) throw guidanceError(Error('Explanation author profile changed; submit a new draft basis'), 'guid-c72cc5837903688a');
          const review = validateExplanationReview(params.review, value.draft.blocks.length);
          const approval = explanationApproval({ sourceRevision: source.revision, currentRevision: source.revision, author: value.author,
            reviewer: actor.accountId, profiles, review });
          if (approval.reason === 'independent_verified_family_required') throw guidanceError(Error('Independent host-verified review family required'), 'guid-6fde0e3c829c7504');
          value.review = { reviewer: actor.accountId, draftFingerprint: value.draftFingerprint!, reviewerProfileFingerprint: explanationProfileFingerprint(profiles, actor.accountId)!, review };
          value.status = approval.approved ? 'approved' : 'changes_requested';
        } else {
          if (value.author !== actor.accountId) throw guidanceError(Error('Explanation author required'), 'guid-8b92767f773fec64');
          if (stillApproved) throw guidanceError(Error('Approved explanation is immutable; a changed source starts a new job'), 'guid-e1fcac77fa5d4c59');
          if (op === 'release') { value.status = 'released'; delete value.draft; delete value.draftFingerprint; delete value.authorProfileFingerprint; delete value.review; }
          else {
            const authorProfileFingerprint = explanationProfileFingerprint(await this.options.executionProfiles(), actor.accountId);
            if (!authorProfileFingerprint) throw guidanceError(Error('Host-verified author profile required for a draft'), 'guid-b99e9635475377ef');
            value.authorProfileFingerprint = authorProfileFingerprint;
            value.draft = validateExplanationDraft(params.draft, source); value.draftFingerprint = fingerprint(value.draft);
            value.status = 'draft'; delete value.review;
          }
        }
      }
      value.receipts.push({ key, payload });
      const serialized = new FrontmatterHandler().stringify({ mcpvault_type: 'explanation_job', explanation: value }, snapshot(value));
      if (Buffer.byteLength(serialized, 'utf8') > RECORD_MAX_BYTES) throw guidanceError(Error('Explanation record byte budget exceeded; prior readable record preserved'), 'guid-dffcb291ce93f03a');
      const receipt = await this.fs.writeNoteWithRevisionGuardsAndReceipt({ path: record.path, expectedRevision: record.revision, mode: 'overwrite',
        content: serialized },
      [{ path: source.path, expectedRevision: source.revision }], { maxBytes: 256_000, assertAccess: async () => {
        await this.actor(actor);
        if (!this.access.canAccessPhysicalPath(source.path, actor)) throw unavailable();
        const profiles = await this.options.executionProfiles();
        if (op === 'claim' && !verifiedExplanationProfile(profiles, actor.accountId)) throw guidanceError(Error('Host-verified profile required to claim explanation work'), 'guid-9fb374d40f180a4b');
        if (['draft', 'review'].includes(op) && value.authorProfileFingerprint !== explanationProfileFingerprint(profiles, value.author)) throw guidanceError(Error('Explanation author profile changed at write boundary'), 'guid-754022c2e84d4657');
        if (op === 'review') {
          if (value.review!.reviewerProfileFingerprint !== explanationProfileFingerprint(profiles, actor.accountId)) throw guidanceError(Error('Explanation reviewer profile changed at write boundary'), 'guid-6e7caeb0e3ef7bfd');
          const decision = explanationApproval({ sourceRevision: source.revision, currentRevision: source.revision, author: value.author, reviewer: actor.accountId, profiles, review: value.review!.review });
          if (decision.reason === 'independent_verified_family_required' || value.status === 'approved' && !decision.approved) throw guidanceError(Error('Review authority changed'), 'guid-8414d83b232a2fe1');
        }
      } });
      return { id: record.id, revision: receipt.revision, sourceRevision: source.revision, status: value.status };
    });
  }
  async nextAction(principal: ScopePrincipal): Promise<{ endpointId: string; arguments: Record<string, unknown>; reason: string } | undefined> {
    return this.observedRead(principal, visible => this.nextActionInternal(principal, visible));
  }
  private async nextActionInternal(principal: ScopePrincipal, visible: Set<string>): Promise<{ endpointId: string; arguments: Record<string, unknown>; reason: string } | undefined> {
    await this.actor(principal);
    if (this.options.canTakeWork && !await this.options.canTakeWork(principal)) return undefined;
    const profiles = await this.options.executionProfiles();
    const own = verifiedExplanationProfile(profiles, principal.accountId);
    if (!own) return undefined;
    const hasOwnWork = await this.hasOwnWork(principal);
    for (const config of this.sources) {
      if (!this.access.canAccessPhysicalPath(config.path, principal)) continue;
      let source: ExplanationSource;
      try { source = await this.source(config, principal); } catch { continue; }
      const record = await this.record(source, config);
      const status = record.value?.status === 'approved' && !await this.approved(record.value, source) ? 'review_required' : record.value?.status ?? 'queued';
      const author = verifiedExplanationProfile(profiles, record.value?.author ?? '');
      const authorBasisCurrent = Boolean(record.value?.authorProfileFingerprint && record.value.authorProfileFingerprint === explanationProfileFingerprint(profiles, record.value.author));
      const review = !hasOwnWork && authorBasisCurrent && ['draft', 'changes_requested', 'review_required'].includes(status) && record.value?.author !== principal.accountId && author?.family && author.family.toLowerCase() !== own.family!.toLowerCase();
      const drafting = !hasOwnWork && ['queued', 'released'].includes(status) && own.family!.toLowerCase() === 'gemini';
      const continuing = ['claimed', 'draft', 'changes_requested', 'review_required'].includes(status) && record.value?.author === principal.accountId;
      if (review || drafting || continuing) {
        visible.add(config.path);
        await this.fresh(source, config, record.revision, principal);
        return { endpointId: 'explanations.read', arguments: { sourcePath: this.external(source.path), expectedSourceRevision: source.revision, expectedRevision: record.revision, maxChars: 6000 },
          reason: review ? 'Review a source-pinned explanation; no model execution requested.' : status === 'draft' && continuing
            ? 'Your explanation is waiting for independent review; do not claim another job or start an optional challenge.'
            : 'Gemini explanation preference; voluntary work, not an empirical ranking or execution grant.' };
      }
    }
    return undefined;
  }
}
