import { guidanceError } from './guidance-runtime.js';
import { ScopeAccessPolicy } from './scope-access.js';
import { normalizeScopeId } from './scopes.js';
import { isModerationHidden } from './moderation-policy.js';
import { coordinate, textField, page, fingerprint } from './work-model.js';
import { projectResearch } from './independent-research-projection.js';
import { validateWorkshopReferences } from './workshop-reference-validation.js';
import { researchFingerprint, validateResearchConfig, validateResearchSubmission, validateResearchReview, } from './independent-research-model.js';
const digest = /^[a-f0-9]{64}$/;
// Canonical round JSON is capped at 128,000 characters. Leave bounded UTF-8
// and Markdown/YAML formatting headroom; oversized host-edited records fail shut.
const ROUND_INVENTORY_BYTES = 1024 * 1024;
/** Managed Markdown, hidden by the existing _whispers service-path boundary.
 * Embargoed prose never enters ordinary Workshop contribution records. */
export class IndependentResearchService {
    fs;
    refs;
    access;
    participantAvailable;
    constructor(fs, refs, access, participantAvailable) {
        this.fs = fs;
        this.refs = refs;
        this.access = access;
        this.participantAvailable = participantAvailable;
    }
    paths(p) {
        const workshopId = normalizeScopeId(p.workshopId, 'workshopId');
        const roundId = normalizeScopeId(p.roundId, 'roundId');
        return { workshopId, roundId, workshop: `Community/Workshops/${workshopId}.md`, record: `_whispers/research/${workshopId}/${roundId}.md` };
    }
    async actor(p) {
        const current = await p.revalidateActor();
        if (!p.principal || current.accountId !== p.principal.accountId)
            throw guidanceError(new Error('Authenticated research participant is required'), 'guid-2e33c61dadd92d77');
        return current;
    }
    async workshop(p, actor) {
        const paths = this.paths(p);
        return { ...paths, ...await this.workshopParent(p.workshopId, actor) };
    }
    async workshopParent(rawId, actor) {
        const workshopId = normalizeScopeId(rawId, 'workshopId'), workshop = `Community/Workshops/${workshopId}.md`;
        if (!this.access.canAccessPhysicalPath(workshop, actor))
            throw guidanceError(new Error('Research workshop unavailable'), 'guid-9205c379d60be0a4');
        const note = await this.fs.readNote(workshop);
        if (note.frontmatter.mcpvault_type !== 'workshop' || note.frontmatter.workshop_id !== workshopId || isModerationHidden(note.frontmatter))
            throw guidanceError(new Error('Research workshop unavailable'), 'guid-9205c379d60be0a4');
        return { workshopId, workshop, note, manager: note.frontmatter.facilitator_account_id === actor.accountId };
    }
    parse(value, workshopId, roundId) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw guidanceError(new Error('Research record is malformed'), 'guid-88c47c5ea991a264');
        const r = value;
        if (r.version !== 1 || r.workshopId !== workshopId || r.roundId !== roundId || !['collecting', 'review', 'closed'].includes(r.phase)
            || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.submissions) || r.submissions.length > 8
            || !Array.isArray(r.reviews) || r.reviews.length > 32 || !Array.isArray(r.receipts) || r.receipts.length > 64
            || !Array.isArray(r.sourceGuards) || r.sourceGuards.length > 120
            || r.sourceGuards.some(g => !g || typeof g.path !== 'string' || g.path.length > 4096 || typeof g.expectedRevision !== 'string' || !digest.test(g.expectedRevision))
            || new Set(r.sourceGuards.map(g => g.path.toLowerCase())).size !== r.sourceGuards.length)
            throw guidanceError(new Error('Research record is malformed'), 'guid-88c47c5ea991a264');
        r.config = validateResearchConfig(r.config);
        const authors = new Set();
        for (const s of r.submissions) {
            if (!s || !r.config.participants.includes(s.accountId) || authors.has(s.accountId))
                throw guidanceError(new Error('Research submissions are malformed'), 'guid-1fe77a3d2af2ca03');
            authors.add(s.accountId);
            s.submission = validateResearchSubmission(s.submission);
            if (researchFingerprint(s.submission) !== s.fingerprint || !Number.isFinite(Date.parse(s.submittedAt)))
                throw guidanceError(new Error('Research submission changed; original snapshot required'), 'guid-010f90a83277ed2b');
        }
        for (const entry of r.reviews) {
            if (!entry || !r.config.participants.includes(entry.accountId) || !Number.isFinite(Date.parse(entry.reviewedAt)))
                throw guidanceError(new Error('Research review is malformed'), 'guid-76f310c2193a139d');
            entry.review = validateResearchReview(entry.review);
            if (entry.accountId === entry.review.targetAccountId || !r.submissions.some(s => s.accountId === entry.review.targetAccountId && s.fingerprint === entry.review.targetFingerprint))
                throw guidanceError(new Error('Research review basis changed'), 'guid-3765c6c8c31c40b1');
        }
        if (r.receipts.some(receipt => !receipt || !digest.test(receipt.key) || !digest.test(receipt.payload)))
            throw guidanceError(new Error('Research retry record is malformed'), 'guid-526d80073cfd2ac8');
        if ((r.phase === 'collecting' && r.disclosedAt) || (r.phase === 'review' && !r.disclosedAt)
            || (r.disclosedAt && (!Number.isFinite(Date.parse(r.disclosedAt)) || authors.size !== r.config.participants.length))
            || (!r.disclosedAt && r.reviews.length))
            throw guidanceError(new Error('Research disclosure state is malformed'), 'guid-eb25f4233ef0478c');
        if (r.phase === 'closed')
            r.closure = this.closure(r.closure);
        else if (r.closure)
            throw guidanceError(new Error('Research closure state is malformed'), 'guid-d300e41662218d46');
        if (r.closure?.outcome === 'synthesis' && (!r.disclosedAt || r.submissions.some(s => !r.reviews.some(e => e.review.targetAccountId === s.accountId && e.review.targetFingerprint === s.fingerprint))))
            throw guidanceError(new Error('Research synthesis requires disclosed independent reviews'), 'guid-b07fa403f9b03e46');
        return r;
    }
    closure(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw guidanceError(new Error('Research closure is required'), 'guid-14286f0a54c75454');
        const v = value;
        if (typeof v.accountId !== 'string' || Object.keys(v).some(k => !['outcome', 'explanation', 'accountId'].includes(k)) || !['synthesis', 'unresolved'].includes(String(v.outcome)))
            throw guidanceError(new Error('Research closure is invalid'), 'guid-a345a4ac6e0962a0');
        return { outcome: v.outcome, explanation: textField(v.explanation, 'explanation', 2000, true), accountId: normalizeScopeId(v.accountId, 'accountId') };
    }
    async evidence(value, path, actor) {
        // The container is the Community workshop, NOT the private service record:
        // submission is an explicit offer to disclose only shareable authored data.
        return validateWorkshopReferences(this.fs, this.refs, value, path, actor);
    }
    async readRecord(path, maxBytes) {
        try {
            return await this.fs.readNote(path, maxBytes);
        }
        catch {
            throw guidanceError(new Error('Research record or source unavailable; restart the read'), 'guid-90f589f177ad6108');
        }
    }
    async rounds(input) {
        if (input.roundId !== undefined || input.expectedRevision !== undefined || input.itemIndex !== undefined)
            throw guidanceError(Error('Round discovery accepts a workshop, not a round/detail locator'), 'guid-354e5d341ee99078');
        const p = { ...input, roundId: '' }, actor = await this.actor(p), w = await this.workshopParent(p.workshopId, actor);
        if (p.expectedWorkshopRevision && p.expectedWorkshopRevision !== w.note.revision)
            throw guidanceError(Error('Research workshop changed; restart discovery'), 'guid-d6603070a0f31d5b');
        const root = `_whispers/research/${w.workshopId}`;
        const watched = new Set([this.fs.noteChangeIdentity(w.workshop)]);
        let changed = false;
        const dispose = this.fs.observeNoteChanges(path => { if (watched.has(this.fs.noteChangeIdentity(path)))
            changed = true; });
        const allowedRecord = (path) => path.startsWith(`${root}/`) && /^[a-z0-9][a-z0-9._-]{0,63}\.md$/.test(path.slice(root.length + 1));
        const authorized = (fm) => fm.mcpvault_type === 'independent_research' && !isModerationHidden(fm)
            && fm.research?.workshopId === w.workshopId && (w.manager || Array.isArray(fm.research?.config?.participants) && fm.research.config.participants.includes(actor.accountId));
        try {
            // Only one known Workshop's private records; filter membership BEFORE the
            // bounded window. No source/configuration/submission metadata is projected.
            const inventory = await this.fs.queryNotes({ pathPrefix: root, limit: 100, includeContent: false, includeTotal: false, sortBy: 'path' }, allowedRecord, n => authorized(n.frontmatter));
            const rows = [], revisions = [];
            for (const candidate of inventory.notes) {
                watched.add(this.fs.noteChangeIdentity(candidate.path));
                const note = await this.readRecord(candidate.path, ROUND_INVENTORY_BYTES);
                if (note.revision !== candidate.revision || !authorized(note.frontmatter))
                    throw guidanceError(Error('Research round inventory changed; restart discovery'), 'guid-5c8b580af3ea20ee');
                const roundId = candidate.path.slice(root.length + 1, -3), r = this.parse(structuredClone(note.frontmatter.research), w.workshopId, roundId);
                revisions.push({ path: candidate.path, revision: note.revision });
                rows.push({ roundId, phase: r.phase, revision: note.revision, statusAction: { endpointId: 'workshop.research', arguments: { workshopId: w.workshopId, roundId, field: 'status', expectedRevision: note.revision, maxChars: 1000 } } });
            }
            for (const item of revisions) {
                let current;
                try {
                    current = await this.fs.readNoteRevision(item.path, ROUND_INVENTORY_BYTES);
                }
                catch {
                    throw guidanceError(new Error('Research record or source unavailable; restart the read'), 'guid-90f589f177ad6108');
                }
                if (current !== item.revision)
                    throw guidanceError(Error('Research round inventory changed; restart discovery'), 'guid-5c8b580af3ea20ee');
            }
            const currentActor = await this.actor(p), parent = await this.workshopParent(p.workshopId, currentActor);
            if (parent.note.revision !== w.note.revision || changed)
                throw guidanceError(Error('Research workshop context changed; restart discovery'), 'guid-7a5842ce70e7d7e8');
            const finalActor = await this.actor(p);
            if (changed || !this.access.canAccessPhysicalPath(w.workshop, finalActor))
                throw guidanceError(Error('Research workshop unavailable'), 'guid-9205c379d60be0a4');
            return page(rows, { workshopId: w.workshopId, workshopRevision: w.note.revision, field: 'rounds', inventoryComplete: !inventory.truncated }, fingerprint({ workshop: w.note.revision, account: actor.accountId, rows, partial: inventory.truncated }), p, `research.rounds:${w.workshopId}`);
        }
        finally {
            dispose();
        }
    }
    async read(input) {
        if (input.field === 'rounds')
            return this.rounds(input);
        if (typeof input.roundId !== 'string')
            throw guidanceError(Error('roundId required for a research round read'), 'guid-681124b9bb507aa0');
        const p = { ...input, roundId: input.roundId };
        const actor = await this.actor(p), w = await this.workshop(p, actor);
        const note = await this.readRecord(w.record);
        if (note.frontmatter.mcpvault_type !== 'independent_research')
            throw guidanceError(new Error('Research round unavailable'), 'guid-41a66fd22fc643a5');
        const r = this.parse(note.frontmatter.research, w.workshopId, w.roundId);
        if (!w.manager && !r.config.participants.includes(actor.accountId))
            throw guidanceError(new Error('Research round unavailable to this participant'), 'guid-806e6583bea4b5ee');
        if (p.expectedRevision && p.expectedRevision !== note.revision)
            throw guidanceError(new Error('Research revision changed; restart the read'), 'guid-a09f6c14941944d1');
        const finishRead = async () => {
            const freshRecord = await this.readRecord(w.record);
            const freshActor = await this.actor(p), freshWorkshop = await this.workshop(p, freshActor);
            if (freshWorkshop.note.revision !== w.note.revision || freshRecord.revision !== note.revision)
                throw guidanceError(new Error('Research context changed; restart the read'), 'guid-22dee94832897d90');
            const finalActor = await this.actor(p);
            if (!this.access.canAccessPhysicalPath(w.workshop, finalActor)
                || (!freshWorkshop.manager && !r.config.participants.includes(finalActor.accountId)))
                throw guidanceError(new Error('Research round unavailable to this participant'), 'guid-806e6583bea4b5ee');
            return finalActor;
        };
        if (p.field === 'status') {
            const maxChars = p.maxChars ?? 4000;
            if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000 || p.cursor !== undefined || p.itemIndex !== undefined)
                throw guidanceError(Error('Research status requires maxChars 512..12000 without a detail cursor'), 'guid-a2aa4d155beac6ea');
            // Never use the normal projection: its envelope includes configuration
            // and submission-account metadata even when no submission is selected.
            let basisState = 'current';
            const observed = [];
            const admitted = (path, principal) => this.access.canAccessPhysicalPath(path, principal)
                && this.access.canReferenceFrom(w.workshop, path);
            for (const guard of r.sourceGuards) {
                try {
                    const paths = await this.refs.validateAndNormalize([guard.path], w.workshop, actor);
                    if (paths.length !== 1 || paths[0] !== guard.path || !admitted(guard.path, actor))
                        throw Error();
                    const current = (await this.fs.readNoteMetadata(paths, path => admitted(path, actor), { fresh: true, strict: true, maxBytes: 8 * 1024 * 1024 }))[0];
                    if (!current || current.revision !== guard.expectedRevision || isModerationHidden(current.frontmatter)
                        || current.frontmatter.content_status === 'deleted')
                        throw Error();
                    observed.push(guard);
                }
                catch {
                    basisState = 'unavailable_or_changed';
                    break;
                }
            }
            let currentActor = await this.actor(p);
            for (const guard of observed) {
                try {
                    if (!admitted(guard.path, currentActor) || await this.fs.readNoteRevision(guard.path, 8 * 1024 * 1024) !== guard.expectedRevision)
                        throw Error();
                }
                catch {
                    basisState = 'unavailable_or_changed';
                    break;
                }
            }
            // Context is the last Markdown read: source I/O must not leave a stale
            // phase or facilitator-only closure route in this minimal projection.
            currentActor = await finishRead();
            if (observed.some(guard => !admitted(guard.path, currentActor)))
                basisState = 'unavailable_or_changed';
            const result = { workshopId: w.workshopId, roundId: w.roundId, field: 'status', revision: note.revision, phase: r.phase, basisState,
                ...(w.manager && r.phase !== 'closed' && { nextAction: { endpointId: 'workshop.research_update', arguments: {
                            workshopId: w.workshopId, roundId: w.roundId, operation: 'close', expectedRevision: note.revision, closure: { outcome: 'unresolved' },
                        }, required: ['requestId', 'closure.explanation'] } }),
            };
            if (JSON.stringify(result).length > maxChars)
                throw guidanceError(Error('Research status exceeds maxChars; request a larger bounded budget'), 'guid-3afc41efee88748a');
            return result;
        }
        const { result, selected } = projectResearch(r, note.revision, actor.accountId, p);
        const checked = [];
        for (const value of [r.config, ...(r.closure ? [r.closure] : []), ...selected])
            checked.push(...await this.evidence(value, w.workshop, actor));
        for (const guard of checked) {
            const original = r.sourceGuards.find(g => g.path.toLowerCase() === guard.path.toLowerCase());
            if (!original || original.expectedRevision !== guard.expectedRevision || (await this.readRecord(guard.path)).revision !== guard.expectedRevision)
                throw guidanceError(new Error('Research source changed; start a new round with current evidence'), 'guid-d160315a1c7b7580');
        }
        await finishRead();
        return result;
    }
    async update(p) {
        return coordinate(async () => {
            const actor = await this.actor(p), w = await this.workshop(p, actor);
            const operation = p.operation;
            if (!operation || !['create', 'submit', 'disclose', 'review', 'close'].includes(operation))
                throw guidanceError(new Error('Research operation is invalid'), 'guid-ecb9856cd12cbd91');
            const unresolvedCleanup = operation === 'close' && p.closure && typeof p.closure === 'object'
                && !Array.isArray(p.closure) && p.closure.outcome === 'unresolved';
            if ((w.note.frontmatter.status === 'closed' || w.note.frontmatter.phase === 'closed') && !unresolvedCleanup)
                throw guidanceError(new Error('Research workshop is closed'), 'guid-bde1a8c5b5212e89');
            const requestId = textField(p.requestId, 'requestId', 128, true);
            const key = researchFingerprint({ accountId: actor.accountId, requestId });
            const payload = researchFingerprint({ operation, config: p.config ?? null, submission: p.submission ?? null, review: p.review ?? null, closure: p.closure ?? null });
            const exists = await this.fs.noteExists(w.record);
            const prior = exists ? await this.readRecord(w.record) : undefined;
            if (prior && prior.frontmatter.mcpvault_type !== 'independent_research')
                throw guidanceError(new Error('Research record unavailable'), 'guid-05dc2d00afb946a5');
            let r = prior ? this.parse(prior.frontmatter.research, w.workshopId, w.roundId) : undefined;
            if (r && !w.manager && !r.config.participants.includes(actor.accountId))
                throw guidanceError(new Error('Research participant unavailable'), 'guid-84277fbbfc398392');
            if (['create', 'disclose', 'close'].includes(operation) && !w.manager)
                throw guidanceError(new Error('Only the current workshop facilitator may manage research rounds'), 'guid-9087dc348a11e837');
            const retry = r?.receipts.find(receipt => receipt.key === key);
            if (retry) {
                if (retry.payload !== payload)
                    throw guidanceError(new Error('Research requestId was reused with a different payload'), 'guid-5b494809499121cd');
                return { success: true, replay: true, workshopId: w.workshopId, roundId: w.roundId, revision: prior.revision, phase: r.phase };
            }
            if (p.expectedRevision !== (prior?.revision || 'missing'))
                throw guidanceError(new Error('Research revision conflict; read the round again'), 'guid-1e1caffcd05ea09f');
            const guards = [];
            if (operation === 'create') {
                if (r)
                    throw guidanceError(new Error('Research round already exists; use a new roundId'), 'guid-59738b31d9867846');
                if (p.expectedWorkshopRevision !== w.note.revision)
                    throw guidanceError(new Error('Workshop revision conflict'), 'guid-1354eb15e72b6f6b');
                const config = validateResearchConfig(p.config);
                for (const account of config.participants)
                    if (!await this.participantAvailable(account))
                        throw guidanceError(new Error('Research participant account unavailable'), 'guid-b5a1cb3ea7ee71df');
                guards.push(...await this.evidence(config, w.workshop, actor));
                r = { version: 1, workshopId: w.workshopId, roundId: w.roundId, config, phase: 'collecting', createdAt: new Date().toISOString(), submissions: [], reviews: [], receipts: [], sourceGuards: [] };
            }
            else {
                if (!r)
                    throw guidanceError(new Error('Research round unavailable'), 'guid-41a66fd22fc643a5');
                if (r.phase === 'closed')
                    throw guidanceError(new Error('Research round is closed; start a new independent round'), 'guid-83ef283ebab99518');
                if (operation === 'submit') {
                    if (r.phase !== 'collecting' || !r.config.participants.includes(actor.accountId))
                        throw guidanceError(new Error('Independent submission is unavailable'), 'guid-a53916cb1bab3a3f');
                    if (r.submissions.some(s => s.accountId === actor.accountId))
                        throw guidanceError(new Error('Research submission is immutable; use a new round for revised independent work'), 'guid-3fed642cdeee15e2');
                    const submission = validateResearchSubmission(p.submission);
                    guards.push(...await this.evidence(submission, w.workshop, actor));
                    r.submissions.push({ accountId: actor.accountId, fingerprint: researchFingerprint(submission), submittedAt: new Date().toISOString(), submission });
                }
                else if (operation === 'disclose') {
                    if (r.phase !== 'collecting' || r.submissions.length !== r.config.participants.length)
                        throw guidanceError(new Error('Waiting for every configured participant to submit evidence or an explicit no-result account'), 'guid-5d5a8198b9833fe6');
                    for (const account of r.config.participants)
                        if (!await this.participantAvailable(account))
                            throw guidanceError(new Error('Research participant account unavailable'), 'guid-b5a1cb3ea7ee71df');
                    guards.push(...await this.evidence(r.config, w.workshop, actor));
                    for (const entry of r.submissions)
                        guards.push(...await this.evidence(entry.submission, w.workshop, actor));
                    r.phase = 'review';
                    r.disclosedAt = new Date().toISOString();
                }
                else if (operation === 'review') {
                    if (r.phase !== 'review' || !r.config.participants.includes(actor.accountId))
                        throw guidanceError(new Error('Research review is unavailable before disclosure'), 'guid-94fd8af05b89b2d3');
                    const review = validateResearchReview(p.review);
                    if (review.targetAccountId === actor.accountId)
                        throw guidanceError(new Error('Self review is not independent review'), 'guid-492a57e79d77f6a2');
                    const target = r.submissions.find(s => s.accountId === review.targetAccountId && s.fingerprint === review.targetFingerprint);
                    if (!target)
                        throw guidanceError(new Error('Research review basis changed'), 'guid-3765c6c8c31c40b1');
                    if (r.reviews.length >= 32)
                        throw guidanceError(new Error('Research review limit reached'), 'guid-7766dc5d95f71c68');
                    guards.push(...await this.evidence(target.submission, w.workshop, actor), ...await this.evidence(review, w.workshop, actor));
                    r.reviews.push({ accountId: actor.accountId, reviewedAt: new Date().toISOString(), review });
                }
                else {
                    if (!p.closure || typeof p.closure !== 'object' || Array.isArray(p.closure) || Object.hasOwn(p.closure, 'accountId'))
                        throw guidanceError(new Error('Research closure must not forge its authenticated author'), 'guid-1b10c25ded478b75');
                    const closure = this.closure({ ...p.closure, accountId: actor.accountId });
                    if (closure.outcome === 'synthesis') {
                        if (!r.disclosedAt || r.submissions.some(s => !r.reviews.some(review => review.review.targetFingerprint === s.fingerprint && review.review.targetAccountId === s.accountId)))
                            throw guidanceError(new Error('Each submission needs independent review before synthesis'), 'guid-a66d8d8e18882c65');
                        for (const entry of [...r.submissions, ...r.reviews])
                            guards.push(...await this.evidence(entry, w.workshop, actor));
                    }
                    guards.push(...await this.evidence(closure, w.workshop, actor));
                    r.phase = 'closed';
                    r.closure = closure;
                }
            }
            // Reserve a stable bounded union when accepting data, so later disclosure
            // never requires more guards than the filesystem writer supports.
            const sources = new Map(r.sourceGuards.map(g => [g.path.toLowerCase(), g]));
            for (const guard of guards) {
                const previous = sources.get(guard.path.toLowerCase());
                if (previous && previous.expectedRevision !== guard.expectedRevision)
                    throw guidanceError(new Error('Research source changed; use a new round'), 'guid-fa25ce009a779f30');
                sources.set(guard.path.toLowerCase(), guard);
            }
            if (sources.size > 120)
                throw guidanceError(new Error('Research source limit reached; use another bounded round'), 'guid-890720f636ad8fed');
            r.sourceGuards = [...sources.values()];
            if (operation === 'disclose' || (operation === 'close' && r.closure?.outcome === 'synthesis'))
                guards.push(...r.sourceGuards);
            r.receipts.push({ key, payload });
            // Keep terminal capacity available even at the normal admission boundary.
            if (r.receipts.length > 64 || JSON.stringify(r).length > (operation === 'close' ? 128000 : 120000))
                throw guidanceError(new Error('Research round storage budget exceeded'), 'guid-fb45c3c74c102841');
            guards.push({ path: w.workshop, expectedRevision: w.note.revision });
            const unique = new Map();
            for (const guard of guards) {
                const before = unique.get(guard.path.toLowerCase());
                if (before && before.expectedRevision !== guard.expectedRevision)
                    throw guidanceError(new Error('Research evidence changed during validation'), 'guid-8afd559be1f10bf8');
                unique.set(guard.path.toLowerCase(), guard);
            }
            await this.actor(p);
            const receipt = await this.fs.writeNoteWithRevisionGuardsAndReceipt({
                path: w.record, expectedRevision: prior?.revision || 'missing',
                content: '# Independent research round\n\nManaged private submissions. Read through workshop.research; never paste an embargoed peer hypothesis into public discussion.\n',
                frontmatter: { mcpvault_type: 'independent_research', research: r },
            }, [...unique.values()], { maxGuards: 128, assertAccess: async () => { await this.actor(p); } }).catch(() => {
                // A late guard conflict can refer to a now-hidden source. Do not expose
                // the filesystem's path/revision-bearing exception through MCP or audit.
                throw guidanceError(new Error('Research update unavailable; recheck authenticated access, revision and source availability'), 'guid-b92a3173a69fee8e');
            });
            return { success: true, workshopId: w.workshopId, roundId: w.roundId, revision: receipt.revision, phase: r.phase };
        });
    }
}
