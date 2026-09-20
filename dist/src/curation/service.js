import { RELATION_FIELDS } from '../graph-contract.js';
import { compilationContentHash } from '../compilation-model.js';
import { isModerationHidden } from '../moderation-policy.js';
import { hash, id, revision, unavailable } from '../evolution/policy.js';
import { curationGrants, curationPath } from './policy.js';
/** Uses the existing evolution lease/journal and change-set writer. No scheduler,
 * model calls, new permission system or automatic content deletion. */
export class CurationService {
    options;
    constructor(options) {
        this.options = options;
    }
    diagnose() {
        return { status: 'diagnostic_only', supportedOperations: ['deduplicate_relations'],
            automaticApplication: false, admission: 'exact_host_grant_and_managed_receipt_per_job', effectVerified: false };
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
    async note(path, c) {
        curationPath(path);
        await c.current();
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
            || flag(fm.legal_hold) || String(fm.retention_policy ?? '').trim().toLowerCase() === 'preserve'
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
        await this.note(job.path, c);
        await c.current();
    }
    validate(job, account) {
        if (job.version !== 1 || job.accountId !== account || !['prepared', 'applying', 'applied', 'reverting', 'withdrawn', 'review_required'].includes(job.state)
            || job.operation !== 'deduplicate_relations' || typeof job.original !== 'string' || job.original.length > 24000
            || compilationContentHash(job.original) !== job.before || !Array.isArray(job.changes) || job.changes.length !== 1
            || job.changes[0]?.path !== job.path || job.changes[0]?.expectedRevision !== job.before
            || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3
            || !Array.isArray(job.requests) || job.requests.length > 16)
            return unavailable();
        curationPath(job.path);
        id(job.id);
        for (const v of [job.before, job.after, job.proof, job.authority, job.fingerprint, job.prepareBasis])
            if (revision(v) === 'missing')
                return unavailable();
    }
    view(job, rev) {
        return { cycleId: job.id, kind: 'curation', status: job.state, revision: rev, operation: job.operation,
            fingerprint: job.fingerprint, removedOccurrences: job.removed,
            ...(job.state === 'applied' && { outputRevision: job.after }), effectVerified: false };
    }
    async execute(op, p, c) {
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
            const request = id(p.requestId), path = curationPath(this.options.access.resolveExternalPath(p.path, c.principal));
            if (!this.options.access.canAccessPhysicalPath(path, c.principal)
                || !this.options.access.canReadProtectedDocument(path, c.principal))
                return unavailable();
            if (p.operation !== 'deduplicate_relations' || revision(p.sourceRevision) === 'missing')
                return unavailable();
            const basis = hash([path, p.operation, p.sourceRevision]);
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
            const set = {};
            let removed = 0, inspected = 0;
            for (const relation of RELATION_FIELDS) {
                const values = note.frontmatter[relation];
                if (values === undefined)
                    continue;
                // Only exact repeated string occurrences; aliases, anchors and evidence objects differ.
                if (!Array.isArray(values) || values.some(v => typeof v !== 'string'))
                    continue;
                inspected += values.length;
                if (inspected > 200)
                    return { status: 'review_required', partial: true, reason: 'relation_budget_exceeded' };
                const unique = [...new Set(values)];
                if (unique.length !== values.length) {
                    set[relation] = unique;
                    removed += values.length - unique.length;
                }
            }
            if (!removed)
                return { status: 'unchanged', wroteOutput: false, effectVerified: false };
            const changes = [{ path, expectedRevision: note.revision, frontmatter: { set } }];
            const policy = { guards: [], assertAccess: async () => {
                    await this.note(path, c);
                    if (await this.grant(path, p.operation, c) !== authority || await this.options.managedProof(path, note.revision, c.principal) !== proof)
                        return unavailable();
                } };
            const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
            job = { version: 1, id: cycleId, accountId: c.principal.accountId, operation: p.operation, path, state: 'prepared',
                original: note.originalContent, before: note.revision, after: preview.changes[0].revision, changes, proof, authority,
                fingerprint: preview.planFingerprint, removed, attempts: 0, prepareRequest: request, prepareBasis: basis, requests: [] };
            await this.assert(job, c);
            const saved = await c.repo.write('curation', cycleId, job, 'missing');
            return this.view(job, saved.revision);
        }
        if (!job)
            return unavailable();
        const currentRevision = (await this.note(job.path, c)).revision;
        if (op === 'read' || op === 'preview') {
            const result = this.view(job, recordRevision);
            return [job.before, job.after].includes(currentRevision) ? result : { ...result, status: 'review_required', reason: 'manual_edit_conflict' };
        }
        const requestId = id(p.requestId), requestBasis = hash([op, p.expectedRevision, p.fingerprint ?? null]);
        const prior = job.requests.find(req => req.id === requestId);
        if (prior) {
            if (prior.basis !== requestBasis || currentRevision !== (job.state === 'withdrawn' ? job.before : job.after))
                return unavailable();
            return this.view(job, recordRevision);
        }
        if (revision(p.expectedRevision) !== recordRevision || job.requests.length >= 16)
            return unavailable();
        const save = async () => { await this.assert(job, c); const s = await c.repo.write('curation', cycleId, job, recordRevision); recordRevision = s.revision; };
        if (op === 'reconcile') {
            if (!['applying', 'reverting'].includes(job.state))
                return unavailable();
            const wanted = job.state === 'applying' ? job.after : job.before;
            job.state = currentRevision === wanted ? job.state === 'applying' ? 'applied' : 'withdrawn' : 'review_required';
            job.requests.push({ id: requestId, basis: requestBasis });
            await save();
            return this.view(job, recordRevision);
        }
        const reverting = op === 'revert';
        if (reverting ? job.state !== 'applied' || currentRevision !== job.after
            : job.state !== 'prepared' || currentRevision !== job.before || p.fingerprint !== job.fingerprint || job.attempts >= 3)
            return unavailable();
        const changes = reverting ? [{ path: job.path, expectedRevision: job.after,
                patches: [{ oldString: (await this.note(job.path, c)).originalContent, newString: job.original }] }] : job.changes;
        const policy = { guards: [], assertAccess: () => this.assert(job, c) };
        const preview = await this.options.fs.patchMultipleNotes({ changes, dryRun: true }, undefined, policy);
        const wanted = reverting ? job.before : job.after;
        if (preview.changes[0]?.revision !== wanted || !reverting && preview.planFingerprint !== job.fingerprint)
            return unavailable();
        job.state = reverting ? 'reverting' : 'applying';
        job.attempts++;
        await save();
        await this.options.fs.patchMultipleNotes({ changes, dryRun: false, confirmPlanFingerprint: preview.planFingerprint }, undefined, policy);
        if ((await this.note(job.path, c)).revision !== wanted)
            return unavailable();
        job.state = reverting ? 'withdrawn' : 'applied';
        job.requests.push({ id: requestId, basis: requestBasis });
        await save();
        return this.view(job, recordRevision);
    }
}
