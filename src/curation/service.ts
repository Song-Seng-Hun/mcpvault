import type { FileSystemService } from '../filesystem.js';
import type { ScopeAccessPolicy } from '../scope-access.js';
import type { ScopePrincipal } from '../scope-auth.js';
import type { EvolutionConfig } from '../evolution/model.js';
import type { EvolutionRepository } from '../evolution/repository.js';
import type { NoteChangeSetItem } from '../types.js';
import { wikiKnowledgeOutput } from '../compilation-policy.js';
import { relationCleanup } from './relation-cleanup.js';
import { compilationContentHash } from '../compilation-model.js';
import { isModerationHidden } from '../moderation-policy.js';
import { hash, id, revision, unavailable } from '../evolution/policy.js';
import { CURATION_OPERATIONS, curationGrants, curationRecordPath, type CurationOperation } from './policy.js';
import type { LlmWikiService } from '../llm-wiki.js';
import { archiveCoverage } from './archive.js';
import { mergePassages, type PassageMapping } from './merge-passages.js';
import { FrontmatterHandler } from '../frontmatter.js';
import { chapterFileMetrics } from '../document-chapter-format.js';

const REFERENCE_BUDGET = { maxFileBytes: 256 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxFiles: 200 };
const isMerge = (operation: string) => operation === 'merge_duplicates' || operation === 'merge_passages';

interface Options {
  fs: FileSystemService; access: ScopeAccessPolicy; config(): Promise<EvolutionConfig>;
  wiki?: LlmWikiService;
  /** Historical host receipt, never a model- or Markdown-supplied ownership claim. */
  managedProof(path: string, revision: string, principal: ScopePrincipal): Promise<string | undefined>;
}
interface Context { principal: ScopePrincipal; repo: EvolutionRepository; current(): Promise<void> }
interface Job {
  version: 1; id: string; accountId: string; operation: CurationOperation; path: string;
  state: 'prepared' | 'resumable' | 'applying' | 'applied' | 'reverting' | 'withdrawn' | 'review_required';
  original: string; before: string; after: string; changes: NoteChangeSetItem[];
  proof: string; authority: string; fingerprint: string; removed: number; attempts: number;
  prepareRequest: string; prepareBasis: string;
  requests: { id: string; basis: string }[];
  replacement?: { path: string; revision: string; proof: string; authority: string; output?: { original: string; after: string } };
  passageCoverage?: PassageMapping[];
}

/** Uses the existing evolution lease/journal and change-set writer. No scheduler,
 * model calls, new permission system or automatic content deletion. */
export class CurationService {
  constructor(private readonly options: Options) {}
  diagnose() { return { status: 'diagnostic_only', supportedOperations: [...CURATION_OPERATIONS],
    automaticApplication: false, admission: 'exact_host_grant_and_managed_receipt_per_job', effectVerified: false,
    referenceImpact: this.options.fs.referenceIntegrityStatus() }; }
  private async grant(path: string, operation: string, c: Context) {
    await c.current();
    const config = await this.options.config();
    if (!config.enabled) return undefined;
    const grant = curationGrants(config.curation ?? []).find(g => g.accountId === c.principal.accountId
      && g.paths.includes(path) && (g.operations as string[]).includes(operation));
    await c.current();
    return grant ? hash([grant, this.options.access.documentDependencyFingerprint([path])]) : undefined;
  }
  private async note(path: string, c: Context, ownedPreserveRevision?: string) {
    curationRecordPath(path); await c.current();
    if (wikiKnowledgeOutput(path) && (!this.options.wiki || !c.principal.capabilities?.includes('publish'))) return unavailable();
    const visible = () => this.options.access.canAccessPhysicalPath(path, c.principal)
      && this.options.access.canReadProtectedDocument(path, c.principal);
    if (!visible()) return unavailable();
    this.options.access.assertMutationAllowed(path, 'evolution.curation');
    const note = await this.options.fs.readNote(path, 24000);
    const fm = note.frontmatter;
    const flag = (v: unknown) => v !== undefined && v !== false && String(v).trim().toLowerCase() !== 'false';
    const until = fm.preserve_until === undefined ? undefined : Date.parse(String(fm.preserve_until));
    if (!visible() || isModerationHidden(fm) || flag(fm.immutable) || fm.llm_wiki_type !== 'knowledge'
      || flag(fm.legal_hold) || String(fm.retention_policy ?? '').trim().toLowerCase() === 'preserve' && note.revision !== ownedPreserveRevision
      || until !== undefined && (!Number.isFinite(until) || until > Date.now())
      || flag(fm.source_only) || fm.processing_mode === 'source_only') return unavailable();
    await c.current(); return note;
  }
  private async assert(job: Job, c: Context) {
    if (job.accountId !== c.principal.accountId || await this.grant(job.path, job.operation, c) !== job.authority
      || await this.options.managedProof(job.path, job.before, c.principal) !== job.proof) return unavailable();
    await this.note(job.path, c, isMerge(job.operation) ? job.after : undefined);
    if (job.replacement) {
      const r = job.replacement;
      if (await this.grant(r.path, job.operation, c) !== r.authority
        || await this.options.managedProof(r.path, r.revision, c.principal) !== r.proof
        || ![r.revision, r.output?.after].includes((await this.note(r.path, c)).revision)) return unavailable();
    }
    await c.current();
  }
  private async noInbound(path: string, c: Context, job?: Job) {
    const impact = await this.options.fs.previewDeleteNote({ path, limit: 200 },
      p => this.options.access.canAccessPhysicalPath(p, c.principal) && this.options.access.canReadProtectedDocument(p, c.principal), REFERENCE_BUDGET)
      .catch(() => undefined);
    await c.current();
    if (!impact || !impact.exists || impact.hiddenReferencesPresent || impact.truncated || impact.ambiguousTotal) return false;
    if (!impact.total) return this.options.fs.referencePreviewFence(impact);
    // The exact owned reverse lineage introduced by this bundle is not a new
    // external dependency. This also permits the writer's guarded recovery.
    const r = job?.replacement;
    const owned = !!r?.output && (await this.note(r.path, c)).revision === r.output.after
      && !impact.affectedLinks.length && impact.affectedProperties.length === impact.total
      && impact.affectedProperties.every(p => p.sourcePath === r.path && /^supersedes(?:\[\d+\])?$/.test(p.propertyPath));
    return owned ? this.options.fs.referencePreviewFence(impact) : false;
  }
  private validate(job: Job, account: string) {
    if (job.version !== 1 || job.accountId !== account || !['prepared', 'resumable', 'applying', 'applied', 'reverting', 'withdrawn', 'review_required'].includes(job.state)
      || !CURATION_OPERATIONS.includes(job.operation) || typeof job.original !== 'string' || job.original.length > 24000
      || compilationContentHash(job.original) !== job.before || !Array.isArray(job.changes) || job.changes.length !== (job.replacement?.output ? 2 : 1)
      || job.changes[0]?.path !== job.path || job.changes[0]?.expectedRevision !== job.before
      || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3
      || !Array.isArray(job.requests) || job.requests.length > 16) return unavailable();
    curationRecordPath(job.path); id(job.id);
    if (wikiKnowledgeOutput(job.path) && job.operation !== 'deduplicate_relations') return unavailable();
    if (job.operation === 'archive_duplicate' || isMerge(job.operation)) {
      const r = job.replacement;
      if (!r || curationRecordPath(r.path).toLowerCase() === job.path.toLowerCase() || wikiKnowledgeOutput(r.path)) return unavailable();
      for (const v of [r.revision, r.proof, r.authority]) if (revision(v) === 'missing') return unavailable();
      if (isMerge(job.operation)) {
        if (!r.output || typeof r.output.original !== 'string' || r.output.original.length > 24000
          || compilationContentHash(r.output.original) !== r.revision || revision(r.output.after) === 'missing'
          || job.changes[1]?.path !== r.path || job.changes[1]?.expectedRevision !== r.revision) return unavailable();
      } else if (r.output) return unavailable();
    } else if (job.replacement) return unavailable();
    if (job.operation === 'deduplicate_relations') {
      const parser = new FrontmatterHandler(), original = parser.parse(job.original);
      const expected = relationCleanup({ ...original, revision: job.before }, job.path);
      if (expected.status !== 'ready' || !expected.removed || expected.removed !== job.removed
        || hash(expected.changes) !== hash(job.changes)) return unavailable();
      const output = parser.preserveStringify(original.matter ?? '', expected.changes[0]!.frontmatter.set, original.content);
      if (compilationContentHash(output) !== job.after) return unavailable();
    }
    if (job.operation === 'merge_passages') {
      const r = job.replacement!, parser = new FrontmatterHandler();
      const source = parser.parse(job.original), target = parser.parse(r.output!.original);
      const plan = mergePassages({ ...source, path: job.path, revision: job.before }, { ...target, path: r.path, revision: r.revision });
      const patches = job.changes[1]?.patches;
      if (plan.status !== 'ready' || hash(job.passageCoverage) !== hash(plan.coverage)
        || patches?.length !== 1 || patches[0]?.oldString !== r.output!.original
        || patches[0]?.newString !== r.output!.original.slice(0, r.output!.original.length - target.content.length) + plan.content) return unavailable();
    } else if (job.passageCoverage !== undefined) return unavailable();
    for (const v of [job.before, job.after, job.proof, job.authority, job.fingerprint, job.prepareBasis]) if (revision(v) === 'missing') return unavailable();
  }
  private view(job: Job, rev: string) {
    return { cycleId: job.id, kind: 'curation', status: job.state, revision: rev, operation: job.operation,
      fingerprint: job.fingerprint, removedOccurrences: job.removed,
      ...(job.operation === 'merge_passages' && { semanticJudgment: 'not_inferred', coverageKind: 'verbatim_union' }),
      ...(job.passageCoverage && { passageCoverage: job.passageCoverage.map(m => ({ ...m, path: this.options.access.toPublicPath(m.path),
        outputPath: this.options.access.toPublicPath(job.replacement!.path), expectedOutputRevision: job.replacement!.output!.after })) }),
      ...(job.state === 'applied' && { outputRevision: job.after,
        outputs: this.targets(job).map(t => ({ path: this.options.access.toPublicPath(t.path), revision: t.after })) }), effectVerified: false };
  }
  private targets(job: Job) {
    return [{ path: job.path, before: job.before, after: job.after, original: job.original },
      ...(job.replacement?.output ? [{ path: job.replacement.path, before: job.replacement.revision,
        after: job.replacement.output.after, original: job.replacement.output.original }] : [])];
  }
  private guards(job: Pick<Job, 'replacement'>) {
    return job.replacement && !job.replacement.output ? [{ path: job.replacement.path, expectedRevision: job.replacement.revision }] : [];
  }
  async execute(op: string, p: Record<string, any>, c: Context): Promise<any> {
    if (!['prepare', 'read', 'preview', 'apply', 'reconcile', 'revert'].includes(op)) return unavailable();
    const cycleId = id(p.cycleId), r = await c.repo.read<Job>('curation', cycleId);
    let job = r.value, recordRevision = r.revision;
    if (job) { this.validate(job, c.principal.accountId); if (job.id !== cycleId) return unavailable(); await this.assert(job, c); }
    if (op === 'prepare') {
      const request = id(p.requestId), path = curationRecordPath(this.options.access.resolveExternalPath(p.path, c.principal));
      if (!this.options.access.canAccessPhysicalPath(path, c.principal)
        || !this.options.access.canReadProtectedDocument(path, c.principal)) return unavailable();
      if (!CURATION_OPERATIONS.includes(p.operation) || revision(p.sourceRevision) === 'missing') return unavailable();
      if (wikiKnowledgeOutput(path) && p.operation !== 'deduplicate_relations') return unavailable();
      const replacementPath = p.operation === 'archive_duplicate' || isMerge(p.operation)
        ? curationRecordPath(this.options.access.resolveExternalPath(p.replacementPath, c.principal)) : undefined;
      if (replacementPath && wikiKnowledgeOutput(replacementPath)) return unavailable();
      const basis = hash(replacementPath ? [path, p.operation, p.sourceRevision, replacementPath, p.replacementRevision]
        : [path, p.operation, p.sourceRevision]);
      if (job) { if (job.prepareRequest !== request || job.prepareBasis !== basis) return unavailable(); return this.view(job, recordRevision); }
      if (revision(p.expectedRevision) !== 'missing') return unavailable();
      const authority = await this.grant(path, p.operation, c);
      if (!authority) return { status: 'diagnostic_only', reason: 'curation_grant_required', automaticApplication: false };
      const note = await this.note(path, c);
      if (note.revision !== p.sourceRevision) return unavailable();
      const proof = await this.options.managedProof(path, note.revision, c.principal);
      if (!proof) return { status: 'review_required', reason: 'managed_receipt_required', automaticApplication: false };
      let replacement: Job['replacement'];
      let passageCoverage: PassageMapping[] | undefined;
      let projectedMergeRevision: string | undefined;
      let changes: NoteChangeSetItem[];
      let removed = 0;
      if (replacementPath) {
        if (replacementPath.toLowerCase() === path.toLowerCase() || !this.options.wiki) return unavailable();
        const target = await this.note(replacementPath, c);
        if (target.revision !== revision(p.replacementRevision)) return unavailable();
        const targetAuthority = await this.grant(replacementPath, p.operation, c);
        const targetProof = await this.options.managedProof(replacementPath, target.revision, c.principal);
        const merge = p.operation === 'merge_passages' ? mergePassages({ ...note, path }, { ...target, path: replacementPath }) : undefined;
        if (!targetAuthority || !targetProof || (merge ? merge.status !== 'ready' : !archiveCoverage({ ...note, path }, { ...target, path: replacementPath })))
          return { status: 'review_required', reason: 'replacement_coverage_or_ownership_unverified' };
        if (!await this.noInbound(path, c)) return { status: 'review_required', reason: 'archive_impact_requires_review' };
        const lifecycle = await this.options.wiki.lifecycleTransitionPreview(c.principal, {
          path, operation: isMerge(p.operation) ? 'supersede' : 'archive',
          ...(isMerge(p.operation) && { replacementPath }),
          reason: p.operation === 'merge_passages'
            ? 'Verified managed passage union; source bytes and ranges pinned in curation receipt.'
            : 'Verified managed duplicate; replacement and coverage pinned in curation receipt.', maxChars: 12000,
        }, { referenceBudget: REFERENCE_BUDGET });
        if (!lifecycle.valid || lifecycle.changes.length !== (isMerge(p.operation) ? 2 : 1)
          || lifecycle.changes[0]?.expectedRevision !== note.revision) return unavailable();
        changes = lifecycle.changes.map(change => ({ ...change, path: this.options.access.resolveExternalPath(change.path, c.principal) }));
        // Knowledge lifecycle and memory eligibility are independent contracts.
        // Retire only this duplicate's memory view; its exact body/history stays.
        const memorySet = Array.isArray(note.frontmatter.memory_entries)
          ? { memory_entries: note.frontmatter.memory_entries.map((entry: Record<string, unknown>) => ({ ...entry, state: 'archived' })) }
          : note.frontmatter.memory_role ? { memory_state: 'archived' } : {};
        if (Object.keys(memorySet).length) changes[0]!.frontmatter = { ...changes[0]!.frontmatter,
          set: { ...changes[0]!.frontmatter?.set, ...memorySet } };
        replacement = { path: replacementPath, revision: target.revision, proof: targetProof, authority: targetAuthority };
        if (isMerge(p.operation)) replacement.output = { original: target.originalContent, after: target.revision };
        if (merge?.status === 'ready') {
          if (changes[1]?.path !== replacementPath || !target.originalContent.endsWith(target.content)) return unavailable();
          const prefix = target.originalContent.slice(0, target.originalContent.length - target.content.length);
          changes[1].patches = [{ oldString: target.originalContent, newString: prefix + merge.content }];
          // Measure the whole physical file, including the owner service's
          // lineage metadata. The writer's actual preview hash must agree.
          const parser = new FrontmatterHandler(), parsed = parser.parse(prefix + merge.content);
          const updates: Record<string, unknown> = { ...changes[1].frontmatter?.set };
          for (const key of changes[1].frontmatter?.remove ?? []) updates[key] = undefined;
          const rendered = parser.preserveStringify(parsed.matter ?? '', updates, parsed.content);
          if (chapterFileMetrics(rendered).lines > 50) return { status: 'review_required', reason: 'chapter_bundle_required' };
          projectedMergeRevision = compilationContentHash(rendered);
          passageCoverage = merge.coverage;
        }
      } else {
        const cleanup = wikiKnowledgeOutput(path)
          ? await this.options.wiki!.managedRelationCleanupPreview(c.principal, path, note.revision)
          : relationCleanup(note, path);
        if (cleanup.status !== 'ready') return cleanup;
        removed = cleanup.removed;
        if (!removed) return { status: 'unchanged', wroteOutput: false, effectVerified: false };
        changes = cleanup.changes;
      }
      const policy = { guards: this.guards({ ...(replacement && { replacement }) }), assertAccess: async () => {
        await this.note(path, c);
        if (await this.grant(path, p.operation, c) !== authority || await this.options.managedProof(path, note.revision, c.principal) !== proof) return unavailable();
      } };
      const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
      if (replacement?.output) {
        if (preview.changes[1]?.path !== replacement.path
          || projectedMergeRevision && preview.changes[1].revision !== projectedMergeRevision) return unavailable();
        replacement.output.after = preview.changes[1].revision;
      }
      job = { version: 1, id: cycleId, accountId: c.principal.accountId, operation: p.operation, path, state: 'prepared',
        original: note.originalContent, before: note.revision, after: preview.changes[0]!.revision, changes, proof, authority,
        fingerprint: preview.planFingerprint, removed, attempts: 0, prepareRequest: request, prepareBasis: basis, requests: [], ...(replacement && { replacement }),
        ...(passageCoverage && { passageCoverage }) };
      await this.assert(job, c);
      const saved = await c.repo.write('curation', cycleId, job, 'missing'); return this.view(job, saved.revision);
    }
    if (!job) return unavailable();
    const targets = this.targets(job);
    const currentRevisions = await Promise.all(targets.map(t => this.note(t.path, c,
      isMerge(job!.operation) && t.path === job!.path ? job!.after : undefined).then(n => n.revision)));
    const matches = (side: 'before' | 'after') => targets.every((t, i) => t[side] === currentRevisions[i]);
    // Only the known forward prefix may resume. A reversed order or any third
    // revision needs review; it is never interpreted as a completed stage.
    const canResume = () => ['applying', 'resumable'].includes(job!.state) && isMerge(job!.operation)
      && targets.length === 2 && currentRevisions[0] === targets[0]!.before && currentRevisions[1] === targets[1]!.after;
    if (op === 'read' || op === 'preview') {
      const result = this.view(job, recordRevision);
      return matches('before') || matches('after') || job.state === 'resumable' && canResume()
        ? result : { ...result, status: 'review_required', reason: 'manual_edit_or_partial_bundle' };
    }
    const requestId = id(p.requestId), requestBasis = hash([op, p.expectedRevision, p.fingerprint ?? null]);
    const prior = job.requests.find(req => req.id === requestId);
    if (prior) {
      if (prior.basis !== requestBasis || !(job.state === 'resumable' ? canResume() : matches(['withdrawn', 'prepared'].includes(job.state) ? 'before' : 'after'))) return unavailable();
      return this.view(job, recordRevision);
    }
    if (revision(p.expectedRevision) !== recordRevision || job.requests.length >= 16) return unavailable();
    const save = async () => { await this.assert(job!, c); const s = await c.repo.write('curation', cycleId, job, recordRevision); recordRevision = s.revision; };
    if (op === 'reconcile') {
      if (!['applying', 'reverting'].includes(job.state)) return unavailable();
      const applying = job.state === 'applying';
      job.state = matches(applying ? 'after' : 'before') ? applying ? 'applied' : 'withdrawn'
        : matches(applying ? 'before' : 'after') ? applying ? 'prepared' : 'applied'
        : applying && canResume() ? 'resumable' : 'review_required';
      job.requests.push({ id: requestId, basis: requestBasis }); await save(); return this.view(job, recordRevision);
    }
    const reverting = op === 'revert';
    const resuming = !reverting && job.state === 'resumable' && canResume();
    if (reverting ? job.state !== 'applied' || !matches('after')
      : !(job.state === 'prepared' && matches('before') || resuming) || p.fingerprint !== job.fingerprint || job.attempts >= 3) return unavailable();
    const changes: NoteChangeSetItem[] = reverting ? await Promise.all(targets.map(async t => ({ path: t.path, expectedRevision: t.after,
      patches: [{ oldString: (await this.options.fs.readNote(t.path, 24000)).originalContent, newString: t.original }] })))
      : job.changes.filter((_, i) => !resuming || currentRevisions[i] === targets[i]!.before);
    let impactFence: (() => void) | undefined;
    const policy = { guards: [...this.guards(job), ...(resuming ? targets.filter((_, i) => currentRevisions[i] === targets[i]!.after)
      .map(t => ({ path: t.path, expectedRevision: t.after })) : [])], assertCurrent: () => impactFence?.(), assertAccess: async () => {
      await this.assert(job!, c);
      if (job!.replacement && !reverting) {
        const fence = await this.noInbound(job!.path, c, job!);
        if (!fence) return unavailable(); impactFence = fence;
      }
    } };
    const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
    const side = reverting ? 'before' : 'after';
    if (preview.changes.some(change => targets.find(t => t.path === change.path)?.[side] !== change.revision)
      || !reverting && !resuming && preview.planFingerprint !== job.fingerprint) return unavailable();
    job.state = reverting ? 'reverting' : 'applying'; if (!reverting) job.attempts++; await save();
    // Publish the canonical first. The old source still contains every byte if
    // the later lineage transition is interrupted. Fingerprints are order-independent.
    const applyChanges = !reverting && isMerge(job.operation) ? [...changes].reverse() : changes;
    await this.options.fs.patchMultipleNotes({ changes: applyChanges, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, undefined, policy);
    for (const t of targets) if ((await this.options.fs.readNote(t.path, 24000)).revision !== t[side]) return unavailable();
    job.state = reverting ? 'withdrawn' : 'applied'; job.requests.push({ id: requestId, basis: requestBasis });
    await save(); return this.view(job, recordRevision);
  }
}
