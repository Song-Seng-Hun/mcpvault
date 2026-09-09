import { guidanceError, guidanceText } from './guidance-runtime.js';
import { evaluateSkill, profileFingerprint } from './skill-evaluation.js';
import { SkillEvolutionStore, rootPath, currentPath, recordPath, skillId, text, expected, revision, fingerprint, bounded, budget, uniqueGuards } from './skill-evolution-store.js';
import { isModerationHidden } from './moderation-policy.js';
const locator = (r) => ({ path: r.path, revision: r.revision });
function candidateBody(body, conditions, previousConditions) {
    const section = (value) => `\n\n## Skill applicability\n\n${value}`;
    let content = body.trimEnd();
    for (const value of [previousConditions, conditions])
        if (value && content.endsWith(section(value)))
            content = content.slice(0, -section(value).length);
    return text(`${content}${section(conditions)}\n`, 'complete candidate content', 32768);
}
/** Skill evolution is opt-in procedural knowledge, not an executor or scheduler. */
export class SkillEvolutionService {
    fs;
    access;
    auth;
    host;
    options;
    store;
    constructor(fs, access, auth, host, options = {}) {
        this.fs = fs;
        this.access = access;
        this.auth = auth;
        this.host = host;
        this.options = options;
        this.store = new SkillEvolutionStore(fs, access, () => host?.attestationKey);
    }
    get enabled() { return this.host?.enabled === true; }
    async transaction(p, operation) {
        await this.actor(p);
        return this.fs.withSkillTransaction(skillId(p.skillId), operation);
    }
    configured() {
        if (!this.enabled)
            throw guidanceError(Error('Skill evolution is disabled by the host'), 'guid-1e757e2b770208b1');
        if (!this.host?.attestationKey || this.host.attestationKey.length < 32)
            throw guidanceError(Error('Skill evolution requires a host-private attestation key'), 'guid-c96f7f686f8179d3');
    }
    async actor(p, mutating = true) {
        this.configured();
        budget(p.maxChars);
        if (mutating && this.options.readOnly)
            throw guidanceError(Error('Skill evolution writes are disabled in read-only mode'), 'guid-edbbabbb311a983d');
        const principal = this.auth.authenticate(p.accessToken);
        if (!principal || !p.principal || fingerprint(principal) !== fingerprint(p.principal))
            throw guidanceError(Error('Authenticated session required for skill evolution'), 'guid-86fe913161faea93');
        const current = (await this.auth.listPrincipals()).find(a => a.accountId === principal.accountId);
        if (!current || current.modelId !== principal.modelId || current.agentId !== principal.agentId || current.role !== principal.role
            || !this.auth.hasCapability(current, 'write') || !this.auth.hasCapability(principal, 'write')
            || !this.access.canAccessPhysicalPath(rootPath(skillId(p.skillId)), principal))
            throw guidanceError(Error('Authenticated skill write account is unavailable'), 'guid-a5360f00f58805f5');
        await this.options.assertActor?.(principal);
        return principal;
    }
    approver(principal) {
        if (!this.host?.approverAccounts.includes(principal.accountId))
            throw guidanceError(Error('Host-approved approval account required'), 'guid-ba697ac3bbd5819c');
    }
    profile(id) {
        const candidates = this.host?.profiles.filter(p => p.skillId === id) || [];
        return candidates.length === 1 ? candidates[0] : undefined;
    }
    request(p, op, actor) {
        const id = text(p.requestId, 'requestId', 128);
        const { principal: _, accessToken: _token, prettyPrint: _pretty, maxChars: _budget, ...input } = p;
        return { id, actor: actor.accountId, payload: fingerprint({ op, input }) };
    }
    requestId(request, kind) { return fingerprint({ actor: request.actor, request: request.id, kind }).slice(0, 24); }
    async replay(path, req, p) {
        return this.store.replay(path, req, p.principal, async () => { await this.actor(p); }, async (record) => {
            const actor = await this.actor(p), d = record.data;
            if (d.kind === 'evaluation' && d.result.profileFingerprint !== profileFingerprint(this.profile(d.skillId)))
                throw guidanceError(Error('Prepared evaluation profile changed; review required'), 'guid-1bd008d019467dd0');
            if ((d.mode === 'auto' || d.validateProfile) && d.profileFingerprint !== undefined && d.profileFingerprint !== profileFingerprint(this.profile(d.skillId)))
                throw guidanceError(Error('Prepared skill profile changed; review required'), 'guid-5c157e50acb74d7e');
            if (d.mode === 'approved' || d.event === 'rollback')
                this.approver(actor);
        });
    }
    result(record, p) {
        const data = record.data;
        return bounded({ path: record.path, revision: record.revision, kind: data.kind,
            ...(data.kind === 'candidate' && { candidateId: data.id, state: data.state }),
            ...(data.kind === 'evaluation' && { evaluationId: data.id, status: data.result.status, reason: data.result.reason }),
            ...(data.kind === 'experience' && { experienceId: data.id, outcome: data.outcome }),
            ...(p.op === 'read' && { content: record.content }),
        }, p.maxChars);
    }
    async save(path, content, data, p, guards, actor, expectedRevision) {
        return this.store.write(path, content, data, expectedRevision, guards, actor, async () => { await this.actor(p); });
    }
    async source(id, principal) {
        const path = `${rootPath(id)}SKILL.md`, note = await this.store.read(path, principal);
        if (note.frontmatter.note_kind !== 'skill' || note.frontmatter.skill_id !== id || note.frontmatter.mcpvault_type)
            throw guidanceError(Error('An admitted skill source is required'), 'guid-59e5dfd45686a768');
        const source = { path, revision: note.revision };
        // Imported sources have at most 32 Markdown files plus retained license.
        const inventory = await this.fs.queryNotes({ pathPrefix: rootPath(id), limit: 34, includeContent: false, includeTotal: false, sortBy: 'path' }, p => this.access.canAccessPhysicalPath(p, principal), n => !n.path.toLowerCase().includes('/_evolution/') && !isModerationHidden(n.frontmatter));
        if (inventory.truncated || inventory.notes.length > 33)
            throw guidanceError(Error('Skill source inventory budget exceeded'), 'guid-3b17ffa76ee80abc');
        const sourceGuards = [];
        for (const n of inventory.notes) {
            const fresh = await this.store.read(n.path, principal);
            sourceGuards.push({ path: n.path, revision: fresh.revision });
        }
        return { source, note, sourceGuards: uniqueGuards([source, ...sourceGuards]) };
    }
    async basis(id, principal) {
        const { source, note, sourceGuards } = await this.source(id, principal);
        const pointer = await this.store.maybe(currentPath(id), principal);
        const original = { source, sourceGuards, path: source.path, revision: source.revision, content: note.content,
            currentRevision: pointer?.revision || 'missing', status: 'original', origin: String(note.frontmatter.skill_origin || ''), license: String(note.frontmatter.skill_license || '') };
        if (!pointer || !this.enabled)
            return original;
        let current;
        try {
            current = await this.store.record(currentPath(id), principal);
            if (current.data.kind !== 'current' || current.data.skillId !== id)
                throw guidanceError(Error('Invalid current skill record'), 'guid-83abea6a0c6c06f4');
            await this.store.check(current.data.guards, principal);
            if (fingerprint(sourceGuards) !== fingerprint(current.data.sourceGuards))
                throw guidanceError(Error('Source inventory changed'), 'guid-43d64c71753d98c6');
            if ((current.data.mode === 'auto' || current.data.validateProfile) && current.data.profileFingerprint !== profileFingerprint(this.profile(id)))
                throw guidanceError(Error('Evaluation profile changed'), 'guid-589511b49b237c9f');
            const target = current.data.active;
            const active = target.path === source.path ? note : (await this.store.record(target.path, principal)).note;
            if (active.revision !== target.revision)
                throw guidanceError(Error('Current skill version changed'), 'guid-518727e38ca464c1');
            return { ...original, current, path: target.path, revision: active.revision, content: active.content, status: target.path === source.path ? 'original' : 'active' };
        }
        catch {
            return { ...original, ...(current && { current }), status: 'needs_review', reason: guidanceText('guid-fc0ee7e770e458a6', 'Current version or its evaluation basis changed; using the source pending review.') };
        }
    }
    async resolve(p) {
        const id = skillId(p.skillId), b = await this.basis(id, p.principal);
        return bounded({ skillId: id, enabled: this.enabled, status: b.status, path: b.path, revision: b.revision, currentRevision: b.currentRevision,
            source: b.source, content: b.content, ...(b.reason && { reason: b.reason }), role: 'procedural_reference',
            notice: 'Procedural reference only; not evidence, installed tools, or execution permission.' }, p.maxChars);
    }
    /** Filter audit records before ranking, independent of forged note properties. */
    discoveryAllowed(path) {
        const normalized = path.replace(/\\/g, '/');
        if (!/^Community\/Skills\/[^/]+\/_evolution(?:\/|$)/i.test(normalized))
            return true;
        return this.enabled && /^Community\/Skills\/[a-z0-9][a-z0-9-]{0,99}\/_evolution\/versions\/[a-f0-9]{24}\.md$/.test(normalized);
    }
    /** Resolve only skills already found by this query, never scan the library. */
    async projectDiscovery(hits, principal, admitted = () => true) {
        const output = [], resolved = new Map();
        for (const hit of hits) {
            const physical = hit.physicalPath || (hit.p.startsWith('scope://') ? this.access.resolveExternalPath(hit.p, principal) : hit.p.replace(/\\/g, '/'));
            if (!admitted(physical) || !this.discoveryAllowed(physical))
                continue;
            if (!this.enabled) {
                output.push(hit);
                continue;
            }
            const match = /^Community\/Skills\/([a-z0-9][a-z0-9-]{0,99})\/(?:SKILL\.md|_evolution\/versions\/[a-f0-9]{24}\.md)$/.exec(physical);
            if (!match) {
                output.push(hit);
                continue;
            }
            const id = match[1];
            if (!resolved.has(id)) {
                if (resolved.size >= 16)
                    continue;
                try {
                    resolved.set(id, await this.basis(id, principal));
                }
                catch {
                    resolved.set(id, undefined);
                }
            }
            const b = resolved.get(id);
            if (!b || !this.access.canAccessPhysicalPath(b.path, principal))
                continue;
            if (!admitted(b.path)) {
                // Explicit filters still own their result set. Keep a matching import
                // as reference rather than silently returning a filtered-out current file.
                if (!physical.includes('/_evolution/'))
                    output.push({ ...hit, nextAction: { endpointId: 'skill.resolve', arguments: { skillId: id, maxChars: 4000 } } });
                continue;
            }
            if (b.path === physical && !physical.includes('/_evolution/')) {
                output.push(hit);
                continue;
            }
            if (output.some(item => (item.physicalPath || item.p) === b.path))
                continue;
            output.push({ p: b.path, physicalPath: b.path, scope: 'community', t: id, ex: b.content.slice(0, 300), mc: hit.mc,
                wk: true, rv: b.revision, why: ['current_version_of_matching_skill'],
                nextAction: { endpointId: 'skill.resolve', arguments: { skillId: id, maxChars: 4000 } } });
        }
        return output;
    }
    async experience(p) {
        return this.transaction(p, () => this.experienceWrite(p));
    }
    async experienceWrite(p) {
        const actor = await this.actor(p), id = skillId(p.skillId), req = this.request(p, 'experience', actor);
        const recordId = this.requestId(req, `experience:${id}`), path = recordPath(id, 'experiences', recordId);
        const prior = await this.replay(path, req, p);
        if (prior)
            return this.result(prior, p);
        if (expected(p.expectedRevision) !== 'missing')
            throw guidanceError(Error('New experience requires expectedRevision=missing'), 'guid-f11d5ffc97a8209d');
        if (p.applied !== true)
            throw guidanceError(Error('Experience requires a skill actually applied, not merely read'), 'guid-48113257900ff3d6');
        if (p.shareable !== true)
            throw guidanceError(Error('Shared experience requires explicit shareable=true'), 'guid-e976c2ec1c93573d');
        if (!['success', 'failure', 'unknown'].includes(p.outcome))
            throw guidanceError(Error('Invalid experience outcome'), 'guid-89daebd163be4d47');
        const b = await this.basis(id, actor);
        const used = await this.store.evidence([p.usedVersion], path, actor, 1);
        if (used[0].path !== b.path || used[0].revision !== b.revision)
            throw guidanceError(Error('Used skill revision is not the current version; preserve older use privately for review'), 'guid-2a1983dd15288e20');
        const evidence = await this.store.evidence(p.evidence, path, actor);
        const context = text(p.context, 'context'), summary = text(p.summary, 'summary');
        const data = { kind: 'experience', id: recordId, skillId: id, actor: actor.accountId, request: req, outcome: p.outcome,
            applied: true, shareable: true, usedVersion: used[0], evidence, context, summary };
        const record = await this.save(path, `# Skill use experience\n\n${context}\n\n${summary}\n`, data, p, [...used, ...evidence], actor, 'missing');
        return this.result(record, p);
    }
    async candidate(p) {
        return ['create', 'update', 'reject'].includes(p.op) ? this.transaction(p, () => this.candidateOperation(p)) : this.candidateOperation(p);
    }
    async candidateOperation(p) {
        const id = skillId(p.skillId), op = p.op || 'read';
        budget(p.maxChars);
        if (op === 'list')
            return this.listCandidates(p);
        if (op === 'read')
            return this.result(await this.store.record(recordPath(id, 'candidates', p.candidateId), p.principal), { ...p, op });
        if (!['create', 'update', 'reject'].includes(op))
            throw guidanceError(Error('Invalid candidate operation'), 'guid-3ae41c6817d99246');
        const actor = await this.actor(p), req = this.request(p, `candidate:${op}`, actor);
        const candidateId = op === 'create' ? this.requestId(req, `candidate:${id}`) : p.candidateId;
        const path = recordPath(id, 'candidates', candidateId), replay = await this.replay(path, req, p);
        if (replay)
            return this.result(replay, p);
        const expectedRevision = expected(p.expectedRevision), b = await this.basis(id, actor);
        let data, content;
        if (op === 'create') {
            if (expectedRevision !== 'missing')
                throw guidanceError(Error('New candidate requires expectedRevision=missing'), 'guid-7f14f37daa0d98f1');
            if (revision(p.baseRevision) !== b.revision || expected(p.expectedCurrentRevision) !== b.currentRevision)
                throw guidanceError(Error('Candidate basis revision changed'), 'guid-2f1c9458954cd4ce');
            const experiences = await this.store.evidence(p.experiences, path, actor);
            const evidence = [];
            for (const guard of experiences) {
                const record = await this.store.record(guard.path, actor);
                if (record.data.kind !== 'experience' || record.data.skillId !== id || record.data.usedVersion.revision !== b.revision)
                    throw guidanceError(Error('Candidate experiences must refer to this skill basis'), 'guid-acef3b6493ff525e');
                evidence.push(...record.data.evidence);
            }
            content = candidateBody(text(p.content, 'content', 32768), text(p.conditions, 'conditions'));
            data = { kind: 'candidate', id: candidateId, skillId: id, actor: actor.accountId, request: req, state: 'proposed',
                reason: text(p.reason, 'reason'), conditions: text(p.conditions, 'conditions'), origin: b.origin, license: b.license,
                base: { path: b.path, revision: b.revision }, baseCurrentRevision: b.currentRevision, sourceGuards: b.sourceGuards,
                requiresApproval: b.currentRevision !== 'missing' && !b.current,
                experiences, evidence: uniqueGuards(evidence) };
        }
        else {
            const old = await this.store.record(path, actor);
            if (old.revision !== expectedRevision)
                throw guidanceError(Error('Candidate revision changed'), 'guid-ee0c78eb83108a5e');
            if (old.data.actor !== actor.accountId)
                this.approver(actor);
            data = { ...old.data, request: req, reason: text(p.reason, 'reason'), state: op === 'reject' ? 'rejected' : 'proposed' };
            if (p.conditions !== undefined)
                data.conditions = text(p.conditions, 'conditions');
            content = op === 'update' ? candidateBody(text(p.content, 'content', 32768), data.conditions, old.data.conditions) : old.content;
        }
        const guards = [...data.sourceGuards, data.base, ...data.experiences, ...data.evidence, { path: currentPath(id), revision: data.baseCurrentRevision }];
        const record = await this.save(path, content, data, p, guards, actor, expectedRevision);
        return this.result(record, p);
    }
    async listCandidates(p) {
        const id = skillId(p.skillId), max = budget(p.maxChars), limit = p.limit ?? 10;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
            throw guidanceError(Error('limit must be 1-20'), 'guid-450920dbb35510bb');
        await this.source(id, p.principal);
        const batch = await this.fs.queryNotes({ pathPrefix: `${rootPath(id)}_evolution/candidates/`, limit: 256, includeContent: false, includeTotal: false, sortBy: 'path' }, path => this.access.canAccessPhysicalPath(path, p.principal), note => !isModerationHidden(note.frontmatter));
        const snapshot = fingerprint(batch.notes.map(n => ({ path: n.path, revision: n.revision })));
        let offset = 0;
        if (p.cursor !== undefined) {
            if (typeof p.cursor !== 'string' || p.cursor.length > 100 || !/^[a-f0-9]{64}:\d{1,3}$/.test(p.cursor))
                throw guidanceError(Error('Invalid candidate cursor'), 'guid-5e9c7fc0c6750c07');
            const [stamp, index] = p.cursor.split(':');
            if (stamp !== snapshot)
                throw guidanceError(Error('Candidate listing changed; restart without cursor'), 'guid-4d96de9fc724632f');
            offset = Number(index);
            if (offset > batch.notes.length)
                throw guidanceError(Error('Invalid candidate cursor'), 'guid-5e9c7fc0c6750c07');
        }
        const items = [];
        let next = offset;
        for (; next < batch.notes.length && items.length < limit; next++) {
            const n = batch.notes[next];
            let record;
            try {
                record = await this.store.record(n.path, p.principal);
            }
            catch {
                continue;
            }
            const item = this.result(record, p);
            if (JSON.stringify({ skillId: id, items: [...items, item], cursor: `${snapshot}:${next + 1}`, truncated: true }).length > max)
                break;
            items.push(item);
        }
        return bounded({ skillId: id, items, truncated: next < batch.notes.length || batch.truncated,
            ...(next < batch.notes.length && { cursor: `${snapshot}:${next}` }), ...(batch.truncated && { reason: guidanceText('guid-fa2558d0abdc16b7', 'Candidate inventory window exhausted; use exact candidateId reads.') }) }, max);
    }
    async nextAction(p) {
        if (!this.enabled)
            return;
        const list = await this.listCandidates({ ...p, limit: 10, maxChars: 4000 });
        for (const candidate of list.items) {
            if (candidate.state !== 'proposed')
                continue;
            try {
                await this.evaluationBasis({ ...p, candidateId: candidate.candidateId });
            }
            catch {
                continue;
            } // Promoted, stale or changed candidates cannot recur as ready work.
            return { endpointId: 'skill.candidate', arguments: { skillId: p.skillId, candidateId: candidate.candidateId, op: 'read', maxChars: 4000 } };
        }
        return;
    }
    async evaluationBasis(p) {
        const id = skillId(p.skillId), candidate = await this.store.record(recordPath(id, 'candidates', p.candidateId), p.principal);
        if (candidate.data.state === 'rejected')
            throw guidanceError(Error('Rejected candidate cannot be evaluated or promoted'), 'guid-af3e50404d031367');
        const d = candidate.data, b = await this.basis(id, p.principal);
        if (b.revision !== d.base.revision || b.path !== d.base.path || b.currentRevision !== d.baseCurrentRevision)
            throw guidanceError(Error('Candidate basis or current revision changed'), 'guid-199dae4c7e2ef98c');
        const guards = uniqueGuards([...d.sourceGuards, d.base, ...d.experiences, ...d.evidence, locator(candidate), { path: currentPath(id), revision: b.currentRevision }]);
        await this.store.check(guards, p.principal);
        return { id, candidate, b, guards };
    }
    async evaluate(p) {
        return p.op === 'run' ? this.transaction(p, () => this.evaluateOperation(p)) : this.evaluateOperation(p);
    }
    async evaluateOperation(p) {
        const id = skillId(p.skillId), op = p.op || 'read';
        if (op === 'read')
            return this.result(await this.store.record(recordPath(id, 'evaluations', p.evaluationId), p.principal), { ...p, op });
        if (op !== 'run')
            throw guidanceError(Error('Invalid evaluation operation'), 'guid-97a0d39ef09687ea');
        const actor = await this.actor(p), req = this.request(p, 'evaluate', actor);
        const evaluationId = this.requestId(req, `evaluation:${id}`), path = recordPath(id, 'evaluations', evaluationId);
        const prior = await this.replay(path, req, p);
        if (prior)
            return this.result(prior, p);
        const { candidate, b, guards } = await this.evaluationBasis(p);
        if (candidate.revision !== revision(p.expectedRevision))
            throw guidanceError(Error('Candidate revision changed'), 'guid-ee0c78eb83108a5e');
        const result = await evaluateSkill(this.profile(id), { skillId: id, baseline: b.content, candidate: candidate.content });
        if (result.profileFingerprint !== profileFingerprint(this.profile(id)))
            throw guidanceError(Error('Host evaluation profile changed during evaluation'), 'guid-e4faf6871790d0a2');
        const record = await this.save(path, `# Comparative skill evaluation\n\n${result.status}: ${result.reason}\n`, { kind: 'evaluation', id: evaluationId, skillId: id, actor: actor.accountId, request: req, candidate: locator(candidate), guards, result }, p, guards, actor, 'missing');
        const response = this.result(record, p);
        if (result.status === 'passed')
            response.nextAction = { endpointId: 'skill.promote', arguments: { skillId: id, candidateId: candidate.data.id,
                    evaluationId, op: 'preview', mode: 'auto', expectedRevision: b.currentRevision } };
        return bounded(response, p.maxChars);
    }
    async promotionPreview(p, actor) {
        const { id, candidate, b, guards } = await this.evaluationBasis(p);
        if (expected(p.expectedRevision) !== b.currentRevision)
            throw guidanceError(Error('Current skill revision changed'), 'guid-b7cd6559d16bf42d');
        const mode = p.mode || 'auto';
        if (mode !== 'auto' && mode !== 'approved')
            throw guidanceError(Error('Invalid promotion mode'), 'guid-0497df1f14c7793e');
        if (mode === 'approved') {
            this.approver(actor);
            text(p.reason, 'reason');
        }
        if (mode === 'auto' && candidate.data.requiresApproval)
            throw guidanceError(Error('An edited current pointer requires host approval'), 'guid-79c18b9055623bc6');
        const evaluation = await this.store.record(recordPath(id, 'evaluations', p.evaluationId), actor);
        if (evaluation.data.candidate.path !== candidate.path || evaluation.data.candidate.revision !== candidate.revision)
            throw guidanceError(Error('Evaluation is for a different candidate revision'), 'guid-3c63e9ee110219c4');
        await this.store.check(evaluation.data.guards, actor);
        if (mode === 'auto' && (evaluation.data.result.status !== 'passed' || !evaluation.data.result.profileFingerprint
            || evaluation.data.result.profileFingerprint !== profileFingerprint(this.profile(id))))
            throw guidanceError(Error('A current passing host evaluation is required for automatic promotion'), 'guid-d00ba8307823b852');
        const allGuards = uniqueGuards([...guards, locator(evaluation)]);
        return { id, candidate, b, evaluation, guards: allGuards, mode,
            fingerprint: fingerprint({ kind: 'promote', actor: actor.accountId, mode, reason: p.reason || '', guards: allGuards,
                profile: profileFingerprint(this.profile(id)), approvals: this.host?.approverAccounts }) };
    }
    async promote(p) {
        return p.op === 'apply' ? this.transaction(p, () => this.promoteOperation(p)) : this.promoteOperation(p);
    }
    async promoteOperation(p) {
        const id = skillId(p.skillId), op = p.op || 'preview', actor = await this.actor(p, op !== 'preview');
        if (!['preview', 'apply'].includes(op))
            throw guidanceError(Error('Invalid promotion operation'), 'guid-61626120fd0b9550');
        const req = op === 'apply' ? this.request(p, 'promote', actor) : undefined;
        if (req) {
            const old = await this.replay(currentPath(id), req, p);
            if (old)
                return this.result(old, p);
        }
        const plan = await this.promotionPreview(p, actor);
        if (op === 'preview')
            return bounded({ skillId: id, candidateId: plan.candidate.data.id, fingerprint: plan.fingerprint, expectedRevision: plan.b.currentRevision,
                nextAction: { endpointId: 'skill.promote', arguments: { skillId: id, candidateId: p.candidateId, evaluationId: p.evaluationId, mode: plan.mode,
                        ...(p.reason && { reason: p.reason }), op: 'apply', expectedRevision: plan.b.currentRevision, fingerprint: plan.fingerprint }, requiredArguments: ['requestId'] } }, p.maxChars);
        if (p.fingerprint !== plan.fingerprint)
            throw guidanceError(Error('Promotion fingerprint changed; preview again'), 'guid-c6fe67fba771f2a1');
        const versionId = this.requestId(req, `version:${id}`), path = recordPath(id, 'versions', versionId);
        let version = await this.replay(path, req, p);
        if (!version)
            version = await this.save(path, plan.candidate.content, { kind: 'version', id: versionId, skillId: id, actor: actor.accountId,
                request: req, origin: plan.b.origin, license: plan.b.license, previous: { path: plan.b.path, revision: plan.b.revision },
                candidate: locator(plan.candidate), evaluation: locator(plan.evaluation), sourceGuards: plan.b.sourceGuards, mode: plan.mode,
                guards: plan.guards.filter(g => g.path !== currentPath(id)),
                profileFingerprint: plan.evaluation.data.result.profileFingerprint }, p, plan.guards, actor, 'missing');
        // Re-check live host policy after I/O and again inside the current-pointer lock.
        const latest = await this.promotionPreview(p, actor);
        if (latest.fingerprint !== plan.fingerprint)
            throw guidanceError(Error('Promotion fingerprint changed; preview again'), 'guid-c6fe67fba771f2a1');
        let previousPointer = null;
        if (plan.b.currentRevision !== 'missing') {
            const snapshotId = this.requestId(req, `pointer-snapshot:${id}`), snapshotPath = recordPath(id, 'snapshots', snapshotId);
            let snapshot = await this.replay(snapshotPath, req, p);
            if (!snapshot) {
                const previous = await this.store.read(currentPath(id), actor);
                if (previous.revision !== plan.b.currentRevision)
                    throw guidanceError(Error('Current pointer changed before preserving its snapshot'), 'guid-8d38dba97cceb6c7');
                snapshot = await this.save(snapshotPath, previous.originalContent, { kind: 'snapshot', id: snapshotId, skillId: id, actor: actor.accountId,
                    request: req, source: { path: currentPath(id), revision: previous.revision } }, p, plan.guards, actor, 'missing');
            }
            previousPointer = locator(snapshot);
        }
        const active = locator(version), transitionId = this.requestId(req, `promotion:${id}`), transitionPath = recordPath(id, 'transitions', transitionId);
        let transition = await this.replay(transitionPath, req, p);
        if (!transition)
            transition = await this.save(transitionPath, `# Skill promotion\n\n${p.reason || 'Fixed host evaluation passed.'}\n`, {
                kind: 'transition', id: transitionId, skillId: id, actor: actor.accountId, request: req, event: 'promote',
                previous: { path: plan.b.path, revision: plan.b.revision }, active, evaluation: locator(plan.evaluation), candidate: locator(plan.candidate),
                previousTransition: plan.b.current?.data.transition || null, mode: plan.mode, reason: p.reason || 'Fixed host evaluation passed.',
                previousPointer,
            }, p, [...plan.guards, active], actor, 'missing');
        const currentData = { kind: 'current', skillId: id, actor: actor.accountId, request: req,
            active, previous: { path: plan.b.path, revision: plan.b.revision }, mode: plan.mode, profileFingerprint: plan.evaluation.data.result.profileFingerprint,
            transition: locator(transition), candidate: locator(plan.candidate),
            previousPointer, sourceGuards: plan.b.sourceGuards,
            guards: uniqueGuards([...plan.guards.filter(g => g.path !== currentPath(id)), active, locator(transition), ...(previousPointer ? [previousPointer] : [])]), reason: p.reason || 'Fixed host evaluation passed.' };
        const record = await this.store.write(currentPath(id), `# Current skill\n\n[[${active.path}]]\n`, currentData, plan.b.currentRevision, currentData.guards, actor, async () => {
            await this.actor(p);
            if (plan.mode === 'approved')
                this.approver(actor);
            if (plan.mode === 'auto' && plan.evaluation.data.result.profileFingerprint !== profileFingerprint(this.profile(id)))
                throw guidanceError(Error('Host profile changed'), 'guid-813185aa5ec4415d');
        });
        return this.result(record, p);
    }
    async rollback(p) {
        return p.op === 'apply' ? this.transaction(p, () => this.rollbackOperation(p)) : this.rollbackOperation(p);
    }
    async rollbackOperation(p) {
        const actor = await this.actor(p, (p.op || 'preview') !== 'preview');
        this.approver(actor);
        const id = skillId(p.skillId), op = p.op || 'preview', reason = text(p.reason, 'reason');
        if (!['preview', 'apply'].includes(op))
            throw guidanceError(Error('Invalid rollback operation'), 'guid-5bb3f3565eef04b7');
        const req = op === 'apply' ? this.request(p, 'rollback', actor) : undefined;
        if (req) {
            const old = await this.replay(currentPath(id), req, p);
            if (old)
                return this.result(old, p);
        }
        const current = await this.store.record(currentPath(id), actor);
        if (current.revision !== expected(p.expectedRevision))
            throw guidanceError(Error('Current skill revision changed'), 'guid-b7cd6559d16bf42d');
        const target = current.data.previous;
        if (!target || target.path === current.data.active.path)
            throw guidanceError(Error('No previous skill version is available'), 'guid-84d510b50def37b8');
        const source = await this.source(id, actor);
        const previous = target.path === source.source.path ? await this.store.read(target.path, actor) : (await this.store.record(target.path, actor)).note;
        if (previous.revision !== target.revision)
            throw guidanceError(Error('Previous version changed; explicit review is required'), 'guid-001cbc301b7855f0');
        const provenance = previous.frontmatter.skill_evolution;
        if (provenance && provenance.kind !== 'version')
            throw guidanceError(Error('Previous target is not an evaluated version'), 'guid-4bf9c2f796ff8ff7');
        if (provenance && (!Array.isArray(provenance.guards) || fingerprint(provenance.sourceGuards) !== fingerprint(source.sourceGuards)))
            throw guidanceError(Error('Previous version evaluation basis changed'), 'guid-9a0a8d28a58b2b82');
        if (provenance?.mode === 'auto' && provenance.profileFingerprint !== profileFingerprint(this.profile(id)))
            throw guidanceError(Error('Previous evaluation profile changed'), 'guid-a6c24e50e5654202');
        const guards = uniqueGuards([target, ...source.sourceGuards, ...(provenance?.guards || [])]);
        await this.store.check(guards, actor);
        const stamp = fingerprint({ actor: actor.accountId, current: locator(current), target, guards, reason, approvals: this.host?.approverAccounts });
        if (op === 'preview')
            return bounded({ skillId: id, fingerprint: stamp, expectedRevision: current.revision, target }, p.maxChars);
        if (p.fingerprint !== stamp)
            throw guidanceError(Error('Rollback fingerprint changed; preview again'), 'guid-b9ba8f18770c6eae');
        // Preserve an immutable transition before replacing the single current pointer.
        const transitionId = this.requestId(req, `rollback:${id}`), path = recordPath(id, 'transitions', transitionId);
        let transition = await this.replay(path, req, p);
        if (!transition)
            transition = await this.save(path, `# Skill rollback\n\n${reason}\n`, { kind: 'transition', skillId: id, id: transitionId,
                request: req, actor: actor.accountId, previous: current.data.active, active: target, reason, event: 'rollback',
                previousTransition: current.data.transition || null }, p, [...guards, locator(current)], actor, 'missing');
        const data = { kind: 'current', skillId: id, actor: actor.accountId, request: req, active: target,
            previous: previous.frontmatter.skill_evolution?.previous || target, mode: 'approved', transition: locator(transition), sourceGuards: source.sourceGuards,
            validateProfile: provenance?.mode === 'auto', profileFingerprint: provenance?.profileFingerprint,
            guards: [...guards, locator(transition)], reason };
        const record = await this.store.write(currentPath(id), `# Current skill after rollback\n\n[[${target.path}]]\n`, data, current.revision, data.guards, actor, async () => {
            await this.actor(p);
            this.approver(actor);
            if (provenance?.mode === 'auto' && provenance.profileFingerprint !== profileFingerprint(this.profile(id)))
                throw guidanceError(Error('Previous evaluation profile changed'), 'guid-a6c24e50e5654202');
        });
        return this.result(record, p);
    }
}
