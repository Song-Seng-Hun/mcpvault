import { wikiKnowledgeOutput } from '../compilation-policy.js';
import { relationCleanup } from './relation-cleanup.js';
import { compilationContentHash } from '../compilation-model.js';
import { isModerationHidden } from '../moderation-policy.js';
import { hash, id, revision, unavailable } from '../evolution/policy.js';
import { CURATION_OPERATIONS, curationGrants, curationRecordPath } from './policy.js';
import { archiveCoverage } from './archive.js';
import { mergePassages } from './merge-passages.js';
import { FrontmatterHandler } from '../frontmatter.js';
import { chapterFileMetrics } from '../document-chapter-format.js';
import { CurationDiscovery } from './discovery.js';
const REFERENCE_BUDGET = { maxFileBytes: 256 * 1024, maxTotalBytes: 4 * 1024 * 1024, maxFiles: 200 };
const isMerge = (operation) => operation === 'merge_duplicates' || operation === 'merge_passages';
/** Uses the existing evolution lease/journal and change-set writer. No scheduler,
 * model calls, new permission system or automatic content deletion. */
export class CurationService {
    options;
    discovery;
    constructor(options) {
        this.options = options;
        this.discovery = new CurationDiscovery({ ...options, advanceAction: (path, revision, c) => this.discoveryAction(path, revision, c) });
    }
    async discoveryAction(path, sourceRevision, c) {
        if (this.options.readOnly || !c.principal.capabilities?.includes('write'))
            return undefined;
        const authority = await this.grant(path, 'deduplicate_relations', c);
        if (!authority)
            return undefined;
        try {
            if ((await this.note(path, c)).revision !== sourceRevision)
                return undefined;
        }
        catch {
            return undefined;
        }
        const basis = hash([c.principal.accountId, path, sourceRevision, authority]);
        return { endpointId: 'evolution.cycle', arguments: { kind: 'curation', op: 'advance', operation: 'deduplicate_relations',
                path: this.options.access.toPublicPath(path), sourceRevision, expectedRevision: 'missing',
                cycleId: `curation-${basis.slice(0, 40)}`, requestId: `curation-${basis.slice(0, 40)}` } };
    }
    diagnose() {
        return { status: 'diagnostic_only', supportedOperations: [...CURATION_OPERATIONS],
            automaticApplication: false, admission: 'exact_host_grant_and_managed_receipt_per_job', effectVerified: false,
            referenceImpact: this.options.fs.referenceIntegrityStatus() };
    }
    async grant(path, operation, c) {
        await c.current();
        const config = await this.options.config();
        if (!config.enabled)
            return undefined;
        const grant = curationGrants(config.curation ?? []).find(g => g.accountId === c.principal.accountId
            && g.paths.includes(path) && g.operations.includes(operation));
        await c.current();
        return grant ? hash([grant, this.options.access.documentDependencyFingerprint([path])]) : undefined;
    }
    async note(path, c, ownedPreserveRevision) {
        curationRecordPath(path);
        await c.current();
        if (wikiKnowledgeOutput(path) && (!this.options.wiki || !c.principal.capabilities?.includes('publish')))
            return unavailable();
        const visible = () => this.options.access.canAccessPhysicalPath(path, c.principal)
            && this.options.access.canReadProtectedDocument(path, c.principal);
        if (!visible())
            return unavailable();
        this.options.access.assertMutationAllowed(path, 'evolution.curation');
        const note = await this.options.fs.readNote(path, 24000);
        const fm = note.frontmatter;
        const flag = (v) => v !== undefined && v !== false && String(v).trim().toLowerCase() !== 'false';
        const until = fm.preserve_until === undefined ? undefined : Date.parse(String(fm.preserve_until));
        if (!visible() || isModerationHidden(fm) || flag(fm.immutable) || fm.llm_wiki_type !== 'knowledge'
            || flag(fm.legal_hold) || String(fm.retention_policy ?? '').trim().toLowerCase() === 'preserve' && note.revision !== ownedPreserveRevision
            || until !== undefined && (!Number.isFinite(until) || until > Date.now())
            || flag(fm.source_only) || fm.processing_mode === 'source_only')
            return unavailable();
        await c.current();
        return note;
    }
    async assert(job, c) {
        if (job.accountId !== c.principal.accountId || await this.grant(job.path, job.operation, c) !== job.authority
            || await this.options.managedProof(job.path, job.before, c.principal) !== job.proof)
            return unavailable();
        await this.note(job.path, c, isMerge(job.operation) ? job.after : undefined);
        if (job.replacement) {
            const r = job.replacement;
            if (await this.grant(r.path, job.operation, c) !== r.authority
                || await this.options.managedProof(r.path, r.revision, c.principal) !== r.proof
                || ![r.revision, r.output?.after].includes((await this.note(r.path, c)).revision))
                return unavailable();
        }
        await c.current();
    }
    async noInbound(path, c, job) {
        const impact = await this.options.fs.previewDeleteNote({ path, limit: 200 }, p => this.options.access.canAccessPhysicalPath(p, c.principal) && this.options.access.canReadProtectedDocument(p, c.principal), REFERENCE_BUDGET)
            .catch(() => undefined);
        await c.current();
        if (!impact || !impact.exists || impact.hiddenReferencesPresent || impact.truncated || impact.ambiguousTotal)
            return false;
        if (!impact.total)
            return this.options.fs.referencePreviewFence(impact);
        // The exact owned reverse lineage introduced by this bundle is not a new
        // external dependency. This also permits the writer's guarded recovery.
        const r = job?.replacement;
        const owned = !!r?.output && (await this.note(r.path, c)).revision === r.output.after
            && !impact.affectedLinks.length && impact.affectedProperties.length === impact.total
            && impact.affectedProperties.every(p => p.sourcePath === r.path && /^supersedes(?:\[\d+\])?$/.test(p.propertyPath));
        return owned ? this.options.fs.referencePreviewFence(impact) : false;
    }
    validate(job, account) {
        if (job.version !== 1 || job.accountId !== account || !['prepared', 'resumable', 'applying', 'applied', 'reverting', 'revert_resumable', 'withdrawn', 'review_required'].includes(job.state)
            || !CURATION_OPERATIONS.includes(job.operation) || typeof job.original !== 'string' || job.original.length > 24000
            || compilationContentHash(job.original) !== job.before || !Array.isArray(job.changes) || job.changes.length !== (job.replacement?.output ? 2 : 1)
            || job.changes[0]?.path !== job.path || job.changes[0]?.expectedRevision !== job.before
            || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3
            || job.rollbackAttempts !== undefined && (!Number.isInteger(job.rollbackAttempts) || job.rollbackAttempts < 0 || job.rollbackAttempts > 3)
            || job.state === 'revert_resumable' && (!isMerge(job.operation) || !job.rollbackAttempts)
            || !Array.isArray(job.requests) || job.requests.length > 16)
            return unavailable();
        curationRecordPath(job.path);
        id(job.id);
        if (wikiKnowledgeOutput(job.path) && job.operation !== 'deduplicate_relations')
            return unavailable();
        if (job.operation === 'archive_duplicate' || isMerge(job.operation)) {
            const r = job.replacement;
            if (!r || curationRecordPath(r.path).toLowerCase() === job.path.toLowerCase() || wikiKnowledgeOutput(r.path))
                return unavailable();
            for (const v of [r.revision, r.proof, r.authority])
                if (revision(v) === 'missing')
                    return unavailable();
            if (isMerge(job.operation)) {
                if (!r.output || typeof r.output.original !== 'string' || r.output.original.length > 24000
                    || compilationContentHash(r.output.original) !== r.revision || revision(r.output.after) === 'missing'
                    || job.changes[1]?.path !== r.path || job.changes[1]?.expectedRevision !== r.revision)
                    return unavailable();
            }
            else if (r.output)
                return unavailable();
        }
        else if (job.replacement)
            return unavailable();
        if (job.operation === 'deduplicate_relations') {
            const parser = new FrontmatterHandler(), original = parser.parse(job.original);
            const expected = relationCleanup({ ...original, revision: job.before }, job.path);
            if (expected.status !== 'ready' || !expected.removed || expected.removed !== job.removed
                || hash(expected.changes) !== hash(job.changes))
                return unavailable();
            const output = parser.preserveStringify(original.matter ?? '', expected.changes[0].frontmatter.set, original.content);
            if (compilationContentHash(output) !== job.after)
                return unavailable();
        }
        if (job.operation === 'merge_passages') {
            const r = job.replacement, parser = new FrontmatterHandler();
            const source = parser.parse(job.original), target = parser.parse(r.output.original);
            const plan = mergePassages({ ...source, path: job.path, revision: job.before }, { ...target, path: r.path, revision: r.revision });
            const patches = job.changes[1]?.patches;
            if (plan.status !== 'ready' || hash(job.passageCoverage) !== hash(plan.coverage)
                || patches?.length !== 1 || patches[0]?.oldString !== r.output.original
                || patches[0]?.newString !== r.output.original.slice(0, r.output.original.length - target.content.length) + plan.content)
                return unavailable();
        }
        else if (job.passageCoverage !== undefined)
            return unavailable();
        for (const v of [job.before, job.after, job.proof, job.authority, job.fingerprint, job.prepareBasis])
            if (revision(v) === 'missing')
                return unavailable();
    }
    view(job, rev) {
        return { cycleId: job.id, kind: 'curation', status: job.state, revision: rev, operation: job.operation,
            fingerprint: job.fingerprint, removedOccurrences: job.removed,
            rollbackAttemptsRemaining: job.rollbackAttempts === undefined ? null : 3 - job.rollbackAttempts,
            ...(job.rollbackAttempts === undefined && { recoveryReview: 'legacy_rollback_history_unverified' }),
            ...(job.operation === 'merge_passages' && { semanticJudgment: 'not_inferred', coverageKind: 'verbatim_union' }),
            ...(job.passageCoverage && { passageCoverage: job.passageCoverage.map(m => ({ ...m, path: this.options.access.toPublicPath(m.path),
                    outputPath: this.options.access.toPublicPath(job.replacement.path), expectedOutputRevision: job.replacement.output.after })) }),
            ...(job.state === 'applied' && { outputRevision: job.after,
                outputs: this.targets(job).map(t => ({ path: this.options.access.toPublicPath(t.path), revision: t.after })) }), effectVerified: false };
    }
    targets(job) {
        return [{ path: job.path, before: job.before, after: job.after, original: job.original },
            ...(job.replacement?.output ? [{ path: job.replacement.path, before: job.replacement.revision,
                    after: job.replacement.output.after, original: job.replacement.output.original }] : [])];
    }
    guards(job) {
        return job.replacement && !job.replacement.output ? [{ path: job.replacement.path, expectedRevision: job.replacement.revision }] : [];
    }
    async advance(p, c) {
        // Explicit session/approved opportunity entry. Existing exact operation grants
        // and ownership checks remain mandatory; this cannot select new permissions.
        const requestId = id(p.requestId), cycleId = id(p.cycleId), deadline = Date.now() + 300000;
        const bounded = { ...c, current: async () => { await c.current(); if (Date.now() > deadline)
                return unavailable(); } };
        const prepared = await this.execute('prepare', { ...p, requestId: `advance-${hash(requestId).slice(0, 40)}` }, bounded);
        if (!prepared.cycleId)
            return prepared;
        // Inspect actual bytes even on idempotent replay. An old completion receipt
        // must not hide a manual edit, partial bundle or lost output after restart.
        const current = await this.execute('read', { cycleId }, bounded);
        if (current.status === 'applying' || current.status === 'reverting')
            return { ...current, partial: true,
                nextAction: { endpointId: 'evolution.cycle', arguments: { kind: 'curation', op: 'reconcile', cycleId,
                        expectedRevision: current.revision, requestId: `reconcile-${hash([requestId, current.revision]).slice(0, 40)}` } } };
        if (current.status !== 'prepared')
            return current;
        await bounded.current();
        return this.execute('apply', { cycleId, requestId: `advance-apply-${hash(requestId).slice(0, 40)}`,
            expectedRevision: current.revision, fingerprint: current.fingerprint }, bounded);
    }
    async execute(op, p, c) {
        if (op === 'list')
            return this.discovery.list(p, c);
        if (op === 'advance')
            return this.advance(p, c);
        if (!['prepare', 'read', 'preview', 'apply', 'reconcile', 'revert'].includes(op))
            return unavailable();
        const cycleId = id(p.cycleId), r = await c.repo.read('curation', cycleId);
        let job = r.value, recordRevision = r.revision;
        if (job) {
            this.validate(job, c.principal.accountId);
            if (job.id !== cycleId)
                return unavailable();
            await this.assert(job, c);
        }
        if (op === 'prepare') {
            const request = id(p.requestId), path = curationRecordPath(this.options.access.resolveExternalPath(p.path, c.principal));
            if (!this.options.access.canAccessPhysicalPath(path, c.principal)
                || !this.options.access.canReadProtectedDocument(path, c.principal))
                return unavailable();
            if (!CURATION_OPERATIONS.includes(p.operation) || revision(p.sourceRevision) === 'missing')
                return unavailable();
            if (wikiKnowledgeOutput(path) && p.operation !== 'deduplicate_relations')
                return unavailable();
            const replacementPath = p.operation === 'archive_duplicate' || isMerge(p.operation)
                ? curationRecordPath(this.options.access.resolveExternalPath(p.replacementPath, c.principal)) : undefined;
            if (replacementPath && wikiKnowledgeOutput(replacementPath))
                return unavailable();
            const basis = hash(replacementPath ? [path, p.operation, p.sourceRevision, replacementPath, p.replacementRevision]
                : [path, p.operation, p.sourceRevision]);
            if (job) {
                if (job.prepareRequest !== request || job.prepareBasis !== basis)
                    return unavailable();
                return this.view(job, recordRevision);
            }
            if (revision(p.expectedRevision) !== 'missing')
                return unavailable();
            const authority = await this.grant(path, p.operation, c);
            if (!authority)
                return { status: 'diagnostic_only', reason: 'curation_grant_required', automaticApplication: false };
            const note = await this.note(path, c);
            if (note.revision !== p.sourceRevision)
                return unavailable();
            const proof = await this.options.managedProof(path, note.revision, c.principal);
            if (!proof)
                return { status: 'review_required', reason: 'managed_receipt_required', automaticApplication: false };
            let replacement;
            let passageCoverage;
            let projectedMergeRevision;
            let changes;
            let removed = 0;
            if (replacementPath) {
                if (replacementPath.toLowerCase() === path.toLowerCase() || !this.options.wiki)
                    return unavailable();
                const target = await this.note(replacementPath, c);
                if (target.revision !== revision(p.replacementRevision))
                    return unavailable();
                const targetAuthority = await this.grant(replacementPath, p.operation, c);
                const targetProof = await this.options.managedProof(replacementPath, target.revision, c.principal);
                const merge = p.operation === 'merge_passages' ? mergePassages({ ...note, path }, { ...target, path: replacementPath }) : undefined;
                if (!targetAuthority || !targetProof || (merge ? merge.status !== 'ready' : !archiveCoverage({ ...note, path }, { ...target, path: replacementPath })))
                    return { status: 'review_required', reason: 'replacement_coverage_or_ownership_unverified' };
                if (!await this.noInbound(path, c))
                    return { status: 'review_required', reason: 'archive_impact_requires_review' };
                const lifecycle = await this.options.wiki.lifecycleTransitionPreview(c.principal, {
                    path, operation: isMerge(p.operation) ? 'supersede' : 'archive',
                    ...(isMerge(p.operation) && { replacementPath }),
                    reason: p.operation === 'merge_passages'
                        ? 'Verified managed passage union; source bytes and ranges pinned in curation receipt.'
                        : 'Verified managed duplicate; replacement and coverage pinned in curation receipt.', maxChars: 12000,
                }, { referenceBudget: REFERENCE_BUDGET });
                if (!lifecycle.valid || lifecycle.changes.length !== (isMerge(p.operation) ? 2 : 1)
                    || lifecycle.changes[0]?.expectedRevision !== note.revision)
                    return unavailable();
                changes = lifecycle.changes.map(change => ({ ...change, path: this.options.access.resolveExternalPath(change.path, c.principal) }));
                // Knowledge lifecycle and memory eligibility are independent contracts.
                // Retire only this duplicate's memory view; its exact body/history stays.
                const memorySet = Array.isArray(note.frontmatter.memory_entries)
                    ? { memory_entries: note.frontmatter.memory_entries.map((entry) => ({ ...entry, state: 'archived' })) }
                    : note.frontmatter.memory_role ? { memory_state: 'archived' } : {};
                if (Object.keys(memorySet).length)
                    changes[0].frontmatter = { ...changes[0].frontmatter,
                        set: { ...changes[0].frontmatter?.set, ...memorySet } };
                replacement = { path: replacementPath, revision: target.revision, proof: targetProof, authority: targetAuthority };
                if (isMerge(p.operation))
                    replacement.output = { original: target.originalContent, after: target.revision };
                if (merge?.status === 'ready') {
                    if (changes[1]?.path !== replacementPath || !target.originalContent.endsWith(target.content))
                        return unavailable();
                    const prefix = target.originalContent.slice(0, target.originalContent.length - target.content.length);
                    changes[1].patches = [{ oldString: target.originalContent, newString: prefix + merge.content }];
                    // Measure the whole physical file, including the owner service's
                    // lineage metadata. The writer's actual preview hash must agree.
                    const parser = new FrontmatterHandler(), parsed = parser.parse(prefix + merge.content);
                    const updates = { ...changes[1].frontmatter?.set };
                    for (const key of changes[1].frontmatter?.remove ?? [])
                        updates[key] = undefined;
                    const rendered = parser.preserveStringify(parsed.matter ?? '', updates, parsed.content);
                    if (chapterFileMetrics(rendered).lines > 50)
                        return { status: 'review_required', reason: 'chapter_bundle_required' };
                    projectedMergeRevision = compilationContentHash(rendered);
                    passageCoverage = merge.coverage;
                }
            }
            else {
                const cleanup = wikiKnowledgeOutput(path)
                    ? await this.options.wiki.managedRelationCleanupPreview(c.principal, path, note.revision)
                    : relationCleanup(note, path);
                if (cleanup.status !== 'ready')
                    return cleanup;
                removed = cleanup.removed;
                if (!removed)
                    return { status: 'unchanged', wroteOutput: false, effectVerified: false };
                changes = cleanup.changes;
            }
            const policy = { guards: this.guards({ ...(replacement && { replacement }) }), assertAccess: async () => {
                    await this.note(path, c);
                    if (await this.grant(path, p.operation, c) !== authority || await this.options.managedProof(path, note.revision, c.principal) !== proof)
                        return unavailable();
                } };
            const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
            if (replacement?.output) {
                if (preview.changes[1]?.path !== replacement.path
                    || projectedMergeRevision && preview.changes[1].revision !== projectedMergeRevision)
                    return unavailable();
                replacement.output.after = preview.changes[1].revision;
            }
            job = { version: 1, id: cycleId, accountId: c.principal.accountId, operation: p.operation, path, state: 'prepared',
                original: note.originalContent, before: note.revision, after: preview.changes[0].revision, changes, proof, authority,
                fingerprint: preview.planFingerprint, removed, attempts: 0, rollbackAttempts: 0, prepareRequest: request, prepareBasis: basis, requests: [], ...(replacement && { replacement }),
                ...(passageCoverage && { passageCoverage }) };
            await this.assert(job, c);
            const saved = await c.repo.write('curation', cycleId, job, 'missing');
            return this.view(job, saved.revision);
        }
        if (!job)
            return unavailable();
        const targets = this.targets(job);
        const currentRevisions = await Promise.all(targets.map(t => this.note(t.path, c, isMerge(job.operation) && t.path === job.path ? job.after : undefined).then(n => n.revision)));
        const matches = (side) => targets.every((t, i) => t[side] === currentRevisions[i]);
        // Forward publishes canonical first; rollback restores source first. Their
        // byte pattern is identical, so only the durable state selects direction.
        const knownPrefix = () => isMerge(job.operation)
            && targets.length === 2 && currentRevisions[0] === targets[0].before && currentRevisions[1] === targets[1].after;
        const canResume = () => ['applying', 'resumable'].includes(job.state) && knownPrefix();
        const canResumeRevert = () => ['reverting', 'revert_resumable'].includes(job.state)
            && job.rollbackAttempts !== undefined && job.rollbackAttempts > 0 && knownPrefix();
        if (op === 'read' || op === 'preview') {
            const result = this.view(job, recordRevision);
            return matches('before') || matches('after') || canResume() || canResumeRevert()
                ? result : { ...result, status: 'review_required', reason: 'manual_edit_or_partial_bundle' };
        }
        const requestId = id(p.requestId), requestBasis = hash([op, p.expectedRevision, p.fingerprint ?? null]);
        const prior = job.requests.find(req => req.id === requestId);
        if (prior) {
            if (prior.basis !== requestBasis || !(job.state === 'resumable' ? canResume()
                : job.state === 'revert_resumable' ? canResumeRevert() : matches(['withdrawn', 'prepared'].includes(job.state) ? 'before' : 'after')))
                return unavailable();
            return this.view(job, recordRevision);
        }
        if (revision(p.expectedRevision) !== recordRevision || job.requests.length >= 16)
            return unavailable();
        const save = async () => { await this.assert(job, c); const s = await c.repo.write('curation', cycleId, job, recordRevision); recordRevision = s.revision; };
        if (op === 'reconcile') {
            if (!['applying', 'reverting'].includes(job.state))
                return unavailable();
            const applying = job.state === 'applying';
            job.state = matches(applying ? 'after' : 'before') ? applying ? 'applied' : 'withdrawn'
                : matches(applying ? 'before' : 'after') ? applying ? 'prepared' : 'applied'
                    : applying && canResume() ? 'resumable' : !applying && canResumeRevert() ? 'revert_resumable' : 'review_required';
            job.requests.push({ id: requestId, basis: requestBasis });
            await save();
            return this.view(job, recordRevision);
        }
        const reverting = op === 'revert';
        const resuming = !reverting && job.state === 'resumable' && canResume();
        const resumingRevert = reverting && job.state === 'revert_resumable' && canResumeRevert();
        if (reverting ? !(job.state === 'applied' && matches('after') || resumingRevert)
            || job.rollbackAttempts === undefined || job.rollbackAttempts >= 3
            : !(job.state === 'prepared' && matches('before') || resuming) || p.fingerprint !== job.fingerprint || job.attempts >= 3)
            return unavailable();
        const changes = reverting ? await Promise.all(targets.filter((_, i) => !resumingRevert || currentRevisions[i] === targets[i].after)
            .map(async (t) => ({ path: t.path, expectedRevision: t.after,
            patches: [{ oldString: (await this.options.fs.readNote(t.path, 24000)).originalContent, newString: t.original }] })))
            : job.changes.filter((_, i) => !resuming || currentRevisions[i] === targets[i].before);
        let impactFence;
        const completedSide = reverting ? 'before' : 'after';
        const policy = { guards: [...this.guards(job), ...(resuming || resumingRevert ? targets.filter((_, i) => currentRevisions[i] === targets[i][completedSide])
                    .map(t => ({ path: t.path, expectedRevision: t[completedSide] })) : [])], assertCurrent: () => impactFence?.(), assertAccess: async () => {
                await this.assert(job, c);
                if (job.replacement && !reverting) {
                    const fence = await this.noInbound(job.path, c, job);
                    if (!fence)
                        return unavailable();
                    impactFence = fence;
                }
            } };
        const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
        const side = reverting ? 'before' : 'after';
        if (preview.changes.some(change => targets.find(t => t.path === change.path)?.[side] !== change.revision)
            || !reverting && !resuming && preview.planFingerprint !== job.fingerprint)
            return unavailable();
        // Only a never-started legacy job can establish a known zero count.
        if (job.rollbackAttempts === undefined && job.state === 'prepared' && job.attempts === 0)
            job.rollbackAttempts = 0;
        job.state = reverting ? 'reverting' : 'applying';
        if (reverting)
            job.rollbackAttempts++;
        else
            job.attempts++;
        await save();
        // Publish the canonical first. The old source still contains every byte if
        // the later lineage transition is interrupted. Fingerprints are order-independent.
        const applyChanges = !reverting && isMerge(job.operation) ? [...changes].reverse() : changes;
        await this.options.fs.patchMultipleNotes({ changes: applyChanges, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, undefined, policy);
        for (const t of targets)
            if ((await this.options.fs.readNote(t.path, 24000)).revision !== t[side])
                return unavailable();
        job.state = reverting ? 'withdrawn' : 'applied';
        job.requests.push({ id: requestId, basis: requestBasis });
        await save();
        return this.view(job, recordRevision);
    }
}
