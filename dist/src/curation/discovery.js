import { randomUUID } from 'node:crypto';
import { curationFeatures } from './discovery-features.js';
import { hash, unavailable } from '../evolution/policy.js';
import { curationActor, curationDocument } from './delivery.js';
/** Bounded, live-validated discovery. Opaque, process-local continuation never
 * exposes hidden paths or turns a cached match into permission to mutate. */
export class CurationDiscovery {
    options;
    cursors = new Map();
    constructor(options) {
        this.options = options;
    }
    async list(p, c) {
        const kind = p.candidateKind ?? 'relations', limit = p.limit ?? 4, max = p.maxChars ?? 4000;
        if (!['relations', 'duplicate_content'].includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 20)
            return unavailable();
        await c.current();
        const capture = await this.options.readIndex?.captureCuration();
        if (!capture)
            return { status: 'diagnostic_only', partial: true, reason: 'curation_index_unavailable', candidates: [], effectVerified: false,
                usage: { coverage: 'unknown' }, nextAction: { endpointId: 'evolution.cycle', arguments: { kind: 'curation', op: 'list', candidateKind: kind } } };
        const config = await this.options.config();
        const policy = this.options.access.documentPolicyFingerprint();
        const basis = hash([c.principal, config, policy, capture.generation, kind]);
        const current = async () => {
            await c.current();
            await capture.assertCurrent();
            if (this.options.access.documentPolicyFingerprint() !== policy || hash(await this.options.config()) !== hash(config))
                return unavailable();
        };
        await current();
        for (const [key, value] of this.cursors)
            if (value.expires <= Date.now())
                this.cursors.delete(key);
        const prior = p.cursor === undefined ? undefined : this.cursors.get(p.cursor);
        if (p.cursor !== undefined && (!prior || prior.basis !== basis)
            || p.expectedIndexRevision !== undefined && p.expectedIndexRevision !== basis)
            return unavailable();
        let after = prior?.after, pending = prior?.pending, more = true, partial = false, scanned = 0, expand = false, budgetStopped = false;
        const candidates = [];
        const revisions = [];
        const visible = (path) => this.options.access.canAccessPhysicalPath(path, c.principal)
            && this.options.access.canReadProtectedDocument(path, c.principal);
        const read = async (s) => {
            if (!visible(s.path))
                return undefined;
            const note = await this.options.fs.readNote(s.path, 24000);
            if (!visible(s.path) || note.revision !== s.revision)
                throw Error('Candidate changed');
            const features = curationFeatures({ ...note, path: s.path, text: note.content });
            if (kind === 'relations' ? !features.relations : features.body !== s.group)
                return undefined;
            return s;
        };
        const packet = (cursor) => ({ status: 'candidates', basis, candidates, partial: partial || more, effectVerified: false,
            usage: { coverage: 'unknown' }, nextAction: cursor ? { endpointId: 'evolution.cycle', arguments: {
                    kind: 'curation', op: 'list', candidateKind: kind, cursor, limit, maxChars: expand ? 12000 : max
                } } : null });
        if (pending) {
            try {
                pending = await read(pending);
            }
            catch {
                pending = undefined;
                partial = true;
            }
        }
        while (more && scanned < 64 && candidates.length < limit) {
            const page = await capture.page({ kind, limit: Math.min(8, 64 - scanned), ...(after && { after }) });
            more = page.truncated;
            if (pending && pending.group !== page.group)
                pending = undefined;
            for (let i = 0; i < page.notes.length; i++) {
                const indexed = page.notes[i], selected = { path: indexed.path, revision: indexed.revision, group: page.group };
                scanned++;
                let live;
                try {
                    live = await read(selected);
                }
                catch {
                    partial = true;
                }
                const position = { group: page.group, path: indexed.path };
                if (!live) {
                    after = position;
                    continue;
                }
                if (kind === 'duplicate_content' && !pending) {
                    pending = live;
                    after = position;
                    continue;
                }
                const chosen = pending && kind === 'duplicate_content' ? [pending, live] : [live];
                const owned = await Promise.all(chosen.map(s => this.options.managedProof(s.path, s.revision, c.principal)));
                const publicPath = (s) => this.options.access.toPublicPath(s.path);
                const usage = async (s) => {
                    const fact = await capture.delivery?.(curationActor(c.principal.accountId), curationDocument(publicPath(s)));
                    return fact ? { coverage: 'observed_requests_only', serverResultAt: fact.observedAt, revision: fact.revision,
                        matchesCurrentRevision: fact.revision === s.revision, actualUse: 'unknown' } : { coverage: 'unknown' };
                };
                const action = kind === 'relations' && owned[0] ? await this.options.advanceAction?.(live.path, live.revision, c) : undefined;
                const card = { kind, path: publicPath(chosen[0]), sourceRevision: chosen[0].revision,
                    usage: await usage(chosen[0]),
                    managed: owned.every(Boolean), automaticApplication: false, ...(action && { execution: 'validation_required' }),
                    ...(chosen.length === 2 && { comparison: { path: publicPath(chosen[1]), sourceRevision: chosen[1].revision,
                            usage: await usage(chosen[1]) }, judgment: 'exact_body_only' }),
                    nextAction: action ?? { endpointId: 'notes.read', arguments: { path: publicPath(chosen[0]) } } };
                candidates.push(card);
                if (JSON.stringify(packet('00000000-0000-0000-0000-000000000000')).length + 8 > max) {
                    candidates.pop();
                    more = true;
                    expand = candidates.length === 0;
                    budgetStopped = true;
                    break;
                }
                revisions.push(...chosen.map((s, i) => ({ ...s, proof: owned[i] })));
                pending = undefined;
                after = position;
                if (candidates.length === limit) {
                    more ||= i + 1 < page.notes.length;
                    break;
                }
            }
            if (budgetStopped || candidates.length === limit || more && JSON.stringify(packet('00000000-0000-0000-0000-000000000000')).length + 350 > max)
                break;
            if (!page.notes.length)
                break;
        }
        await current();
        for (const selected of revisions)
            if (!await read(selected)
                || await this.options.managedProof(selected.path, selected.revision, c.principal) !== selected.proof)
                return unavailable();
        await current();
        let cursor;
        if (more) {
            while (this.cursors.size >= 128)
                this.cursors.delete(this.cursors.keys().next().value);
            cursor = randomUUID();
            this.cursors.set(cursor, { basis, ...(after && { after }), ...(pending && { pending }), expires: Date.now() + 300000 });
        }
        return packet(cursor);
    }
}
