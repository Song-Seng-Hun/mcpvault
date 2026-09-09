import { guidanceError } from './guidance-runtime.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isModerationHidden } from './moderation-policy.js';
import { FrontmatterHandler } from './frontmatter.js';
import { posix } from 'node:path';
import { ReferenceService } from './references.js';
import { withSkillEvolutionWrite } from './skill-evolution-boundary.js';
export const SKILL_RECORD_BYTES = 256 * 1024;
export const SKILL_ROOT = 'Community/Skills/';
export function canonical(value) {
    let nodes = 0, chars = 0;
    const seen = new Set();
    const sort = (v, depth = 0) => {
        if (++nodes > 20000 || depth > 24)
            throw guidanceError(Error('Skill data structure budget exceeded'), 'guid-750fe0f94fdc0402');
        if (typeof v === 'string') {
            chars += v.length;
            if (chars > 512 * 1024)
                throw guidanceError(Error('Skill data size budget exceeded'), 'guid-4f90a869929954fd');
            return v;
        }
        if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v !== 'object' || seen.has(v))
            throw guidanceError(Error('Skill data must be bounded JSON without cycles'), 'guid-383fff7946bfee80');
        seen.add(v);
        const output = Array.isArray(v) ? v.map(item => sort(item, depth + 1))
            : Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, sort(val, depth + 1)]));
        seen.delete(v);
        return output;
    };
    return JSON.stringify(sort(value)) ?? 'null';
}
export const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export function skillId(value) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value))
        throw guidanceError(Error('Invalid skill id'), 'guid-b77a917c971234ec');
    return value;
}
export const rootPath = (id) => `${SKILL_ROOT}${skillId(id)}/`;
export const currentPath = (id) => `${rootPath(id)}_evolution/current.md`;
export function recordPath(id, kind, recordId) {
    if (typeof recordId !== 'string' || !/^[a-f0-9]{24}$/.test(recordId))
        throw guidanceError(Error('Invalid skill record id'), 'guid-ecd4feb0387a91d1');
    if (!['experiences', 'candidates', 'evaluations', 'versions', 'transitions', 'snapshots'].includes(kind))
        throw guidanceError(Error('Invalid skill record kind'), 'guid-119718204a20e287');
    return `${rootPath(id)}_evolution/${kind}/${recordId}.md`;
}
export function text(value, field, max = 2000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
        throw guidanceError(Error(`${field} must contain 1-${max} characters`), 'guid-a33b2a59ee786263');
    // A conservative admission aid, not a complete secret classifier. Sharing is explicit.
    if (/(?:_scopes[\\/]|_whispers[\\/]|scope:\/\/(?:model|agent|user)\/|[a-z]:[\\/]Users[\\/](?![<{])|\/Users\/[^<{\s]|\/home\/[^<{\s]|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_\-]{20,}|https?:\/\/[^/\s]+:[^/\s]+@)/i.test(value))
        throw guidanceError(Error('Shared skill text contains private scope or sensitive material; keep it private'), 'guid-d8045b43d6d47fd0');
    return value;
}
export function revision(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
        throw guidanceError(Error('An exact current revision is required'), 'guid-17f01d44281e7035');
    return value;
}
export function expected(value) { return value === 'missing' ? 'missing' : revision(value); }
export function budget(value) {
    const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value ?? 4000;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1024 || n > 12000)
        throw guidanceError(Error('maxChars must be 1024-12000'), 'guid-7de0659dc2d89804');
    return n;
}
export function bounded(result, maxChars) {
    const max = budget(maxChars), output = { ...result };
    if (canonical(output).length <= max)
        return output;
    if (typeof output.content === 'string') {
        const content = output.content;
        delete output.content;
        output.truncated = true;
        output.nextAction = { endpointId: 'notes.read', arguments: { path: output.path, expectedRevision: output.revision, maxChars: max } };
        let lo = 0, hi = content.length;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (canonical({ ...output, content: content.slice(0, mid) }).length <= max)
                lo = mid;
            else
                hi = mid - 1;
        }
        output.content = content.slice(0, lo);
    }
    if (canonical(output).length > max)
        throw guidanceError(Error('Skill response budget exhausted; use a larger maxChars'), 'guid-cba0f96f370ea185');
    return output;
}
/** Visible Markdown owns state. Only a host-held key attests service decisions.
 * The key must never be supplied by an MCP request or stored in the Vault. */
export class SkillEvolutionStore {
    fs;
    access;
    key;
    constructor(fs, access, key) {
        this.fs = fs;
        this.access = access;
        this.key = key;
    }
    signature(path, content, fm) {
        const key = this.key();
        if (!key || key.length < 32)
            throw guidanceError(Error('Skill evolution requires a host-private attestation key of at least 32 characters'), 'guid-346e87ff255d750f');
        const { skill_attestation: _, ...properties } = fm;
        return createHmac('sha256', key).update(canonical({ commandCenter: this.access.getCommandCenterId(), path, content, properties })).digest('hex');
    }
    admit(path, principal) {
        const raw = this.access.resolveExternalPath(path, principal).replace(/\\/g, '/');
        if (posix.isAbsolute(raw) || raw.includes(':') || raw.split('/').some(p => p !== '.' && p !== '..' && /[. ]$/.test(p)))
            throw guidanceError(Error('Skill target path is unavailable'), 'guid-7652aec8e7634f33');
        const physical = posix.normalize(raw);
        if (physical === '..' || physical.startsWith('../'))
            throw guidanceError(Error('Skill target path is unavailable'), 'guid-7652aec8e7634f33');
        // Refuse even in-Vault symlink aliases: permission applies to the actual
        // source, not a public-looking link to a private or filtered subtree.
        for (let probe = physical; probe !== '.' && probe !== ''; probe = posix.dirname(probe)) {
            try {
                const actual = this.fs.canonicalReferencePath(probe);
                if (actual.toLowerCase() !== probe.toLowerCase())
                    throw guidanceError(Error('Skill target path alias is unavailable'), 'guid-da5619e51af1e8a3');
                break;
            }
            catch (error) {
                if (!['ENOENT', 'ENOTDIR'].includes(String(error.code)))
                    throw error;
            }
        }
        if (!this.access.canAccessPhysicalPath(physical, principal))
            throw guidanceError(Error('Skill target is unavailable'), 'guid-d77f67f18ad7a3f7');
        return physical;
    }
    async read(path, principal) {
        const physical = this.admit(path, principal);
        const note = await this.fs.readNote(physical, SKILL_RECORD_BYTES);
        if (!this.access.canAccessPhysicalPath(physical, principal) || isModerationHidden(note.frontmatter))
            throw guidanceError(Error('Skill target is unavailable'), 'guid-d77f67f18ad7a3f7');
        return note;
    }
    async maybe(path, principal) {
        this.admit(path, principal);
        return await this.fs.noteExists(path) ? this.read(path, principal) : undefined;
    }
    attested(path, note) {
        const seal = note.frontmatter.skill_attestation;
        if (typeof seal !== 'string' || !/^[a-f0-9]{64}$/.test(seal))
            return false;
        try {
            return timingSafeEqual(Buffer.from(seal, 'hex'), Buffer.from(this.signature(path, note.content, note.frontmatter), 'hex'));
        }
        catch {
            return false;
        }
    }
    async record(path, principal) {
        const note = await this.read(path, principal);
        if (!this.attested(path, note) || !note.frontmatter.skill_evolution)
            throw guidanceError(Error('Skill record attestation changed; preserve the edit and review it'), 'guid-ad0b11f435d3836b');
        const journal = await this.journal(path, principal), latest = journal.at(-1);
        if (!latest)
            throw guidanceError(Error('Skill journal receipt is missing; explicit review required'), 'guid-59df65354c9be060');
        let intent = await this.journalRecord(latest.path, principal);
        if (!await this.committed(intent, principal) && intent.data.before === note.revision && journal.length > 1) {
            intent = await this.journalRecord(journal[journal.length - 2].path, principal);
        }
        if (intent.data.target !== path || intent.data.resultRevision !== note.revision
            || !await this.committed(intent, principal))
            throw guidanceError(Error('Skill record freshness changed; preserve the replay or interrupted write for review'), 'guid-5b1bfde7341d1f04');
        return { path, revision: note.revision, content: note.content, data: note.frontmatter.skill_evolution, note };
    }
    journalRoot(path) {
        const match = /^Community\/Skills\/([a-z0-9-]+)\/_evolution\//.exec(path);
        if (!match)
            throw guidanceError(Error('Invalid skill journal target'), 'guid-0624919ee0fe1ccc');
        return `${rootPath(match[1])}_evolution/receipts/${fingerprint(path).slice(0, 24)}/`;
    }
    async journal(path, principal) {
        const prefix = this.journalRoot(path);
        this.admit(prefix.slice(0, -1), principal);
        const batch = await this.fs.queryNotes({ pathPrefix: prefix, limit: 257, includeContent: false, includeTotal: false, sortBy: 'path' }, p => this.access.canAccessPhysicalPath(p, principal));
        if (batch.truncated || batch.notes.length > 256)
            throw guidanceError(Error('Skill journal budget exhausted; host review required'), 'guid-2a8ae444ba7257ff');
        for (let i = 0; i < batch.notes.length; i++) {
            if (!batch.notes[i].path.startsWith(`${prefix}${String(i + 1).padStart(4, '0')}-`))
                throw guidanceError(Error('Skill journal sequence changed; host review required'), 'guid-aab08bd8c4d25c8a');
        }
        return batch.notes;
    }
    async journalRecord(path, principal) {
        const note = await this.read(path, principal);
        if (!this.attested(path, note) || !note.frontmatter.skill_evolution)
            throw guidanceError(Error('Skill journal attestation changed'), 'guid-3089958226755015');
        return { path, revision: note.revision, content: note.content, data: note.frontmatter.skill_evolution, note };
    }
    commitPath(intent) {
        return `${rootPath(intent.data.skillId)}_evolution/commits/${fingerprint(intent.path).slice(0, 24)}.md`;
    }
    async committed(intent, principal) {
        const path = this.commitPath(intent);
        if (!await this.maybe(path, principal))
            return false;
        const receipt = await this.journalRecord(path, principal);
        if (receipt.data.intent?.path !== intent.path || receipt.data.intent?.revision !== intent.revision)
            throw guidanceError(Error('Skill commit receipt changed'), 'guid-4f7fb5f4c2de9906');
        return true;
    }
    async journalWrite(path, data, principal, assertActor) {
        this.admit(path, principal);
        this.access.assertMutationAllowed(path, 'skill.evolution');
        const fm = { note_kind: 'resource', llm_wiki_type: 'knowledge', lifecycle: 'review', skill_record_kind: 'receipt', skill_evolution: data };
        const content = '# Skill write receipt\n';
        const normalized = new FrontmatterHandler().parse(new FrontmatterHandler().stringify(fm, content));
        fm.skill_attestation = this.signature(path, normalized.content, normalized.frontmatter);
        await withSkillEvolutionWrite(path, () => this.fs.writeNoteWithReceipt({ path, content, frontmatter: fm, expectedRevision: 'missing' }, { maxBytes: SKILL_RECORD_BYTES, assertAccess: async () => { await assertActor(); this.admit(path, principal); } }));
        return this.journalRecord(path, principal);
    }
    snapshot(intent) {
        const parsed = new FrontmatterHandler().parse(intent.data.serialized);
        return { path: intent.data.target, revision: intent.data.resultRevision, content: parsed.content,
            data: parsed.frontmatter.skill_evolution, note: { ...parsed, path: intent.data.target, revision: intent.data.resultRevision } };
    }
    /** Durable historical response; it never makes a historical revision current. */
    async replay(path, request, principal, assertActor, assertPolicy) {
        const entries = await this.journal(path, principal);
        const suffix = `-${fingerprint({ actor: request.actor, id: request.id }).slice(0, 24)}.md`;
        const found = entries.find(n => n.path.endsWith(suffix));
        if (!found)
            return;
        const intent = await this.journalRecord(found.path, principal);
        if (intent.data.request?.payload !== request.payload)
            throw guidanceError(Error('requestId was reused with a different payload'), 'guid-285e329a14bc89b6');
        if (await this.committed(intent, principal))
            return this.snapshot(intent);
        const actual = await this.maybe(path, principal);
        if (actual?.revision === intent.data.resultRevision) {
            // The exact write landed before interruption; only finish its receipt.
            await assertPolicy(this.snapshot(intent));
            await this.check(intent.data.guards, principal);
            await this.journalWrite(this.commitPath(intent), { kind: 'commit', skillId: intent.data.skillId, intent: { path: intent.path, revision: intent.revision } }, principal, assertActor);
            return this.snapshot(intent);
        }
        if ((actual?.revision || 'missing') === intent.data.before)
            return; // Re-run current policy before resuming the prepared write.
        throw guidanceError(Error('Interrupted skill request target changed; explicit review required'), 'guid-964c4ba9a1a23ae6');
    }
    async check(guards, principal) {
        for (const guard of guards) {
            const note = await this.maybe(guard.path, principal);
            if ((note?.revision || 'missing') !== guard.revision)
                throw guidanceError(Error('Skill basis or evidence revision changed; read and evaluate again'), 'guid-1e58dff2e2da1563');
        }
    }
    async evidence(value, container, principal, max = 8) {
        if (!Array.isArray(value) || !value.length || value.length > max)
            throw guidanceError(Error(`Evidence must contain 1-${max} exact visible locators`), 'guid-0672a72f9153e4c7');
        const guards = [];
        for (const item of value) {
            if (!item || typeof item.path !== 'string')
                throw guidanceError(Error('Evidence path is required'), 'guid-1609f5b55dc8a646');
            const path = this.admit(item.path, principal);
            if (!this.access.canReferenceFrom(container, path) || /(?:^|\/)(?:_scopes|_whispers)(?:\/|$)/i.test(path))
                throw guidanceError(Error('Private evidence cannot be copied or linked into shared skill records'), 'guid-f4accd5e2287ad8b');
            const note = await this.read(path, principal);
            if (note.revision !== revision(item.revision))
                throw guidanceError(Error('Evidence revision changed'), 'guid-4a0de88dfa846eee');
            guards.push({ path, revision: note.revision });
        }
        return uniqueGuards(guards);
    }
    async write(path, content, data, expectedRevision, guards, principal, assertActor) {
        this.admit(path, principal);
        this.access.assertMutationAllowed(path, 'skill.evolution');
        // All user-authored prose shares the public container's scope. Resolve
        // aliases and embeds, not just obvious private path spellings.
        const authored = [content, data.context, data.summary, data.reason, data.conditions].filter(v => typeof v === 'string').join('\n\n');
        try {
            await new ReferenceService(this.fs, this.access).validateAndNormalize([], path, principal, authored, { strictBodyLinks: true });
        }
        catch {
            throw guidanceError(Error('Shared skill text contains an unavailable or private reference'), 'guid-60eac750b58cdb40');
        }
        const fm = { llm_wiki_type: 'knowledge', note_kind: data.kind === 'version' ? 'skill' : data.kind === 'candidate' ? 'experiment' : 'resource', lifecycle: 'review',
            title: `${data.skillId} / ${data.kind}`, skill_id: data.skillId, skill_record_kind: data.kind, skill_evolution: data,
            recorded_at: new Date().toISOString(),
            ...(data.kind === 'version' && { memory_role: 'procedural', skill_origin: data.origin, skill_license: data.license,
                references: [`[[${rootPath(data.skillId)}SKILL.md]]`, `[[${rootPath(data.skillId)}IMPORT-LICENSE.md]]`] }) };
        // Sign the exact parsed representation that FileSystemService writes.
        const normalized = new FrontmatterHandler().parse(new FrontmatterHandler().stringify(fm, content));
        fm.skill_attestation = this.signature(path, normalized.content, normalized.frontmatter);
        const unique = uniqueGuards(guards).filter(g => g.path !== path);
        if (!unique.length || unique.length > 100)
            throw guidanceError(Error('Skill revision guard budget exceeded'), 'guid-fa1e6a084d73c73c');
        const entries = await this.journal(path, principal);
        const suffix = `-${fingerprint({ actor: data.request.actor, id: data.request.id }).slice(0, 24)}.md`;
        const prior = entries.find(n => n.path.endsWith(suffix));
        let intent;
        if (prior) {
            intent = await this.journalRecord(prior.path, principal);
            if (prior.path !== entries.at(-1)?.path || await this.committed(intent, principal))
                throw guidanceError(Error('Skill request already superseded; reread its receipt'), 'guid-b8f2122003746ce3');
            if (intent.data.request.payload !== data.request.payload || intent.data.before !== expectedRevision)
                throw guidanceError(Error('Skill request intent changed'), 'guid-6793de6bf2f58ba7');
            if (intent.data.dataFingerprint !== fingerprint(data) || fingerprint(intent.data.guards) !== fingerprint(unique))
                throw guidanceError(Error('Prepared skill policy or guards changed; explicit review required'), 'guid-739f905d8ec7004a');
        }
        else {
            if (entries.length >= 256)
                throw guidanceError(Error('Skill journal budget exhausted; host review required'), 'guid-2a8ae444ba7257ff');
            if (entries.length && !await this.committed(await this.journalRecord(entries.at(-1).path, principal), principal)
                && !(data.kind === 'current' && data.mode === 'approved'))
                throw guidanceError(Error('Prior skill request is interrupted; retry that request first'), 'guid-0b17e82d813d3fd3');
            await this.check([...unique, { path, revision: expectedRevision }], principal);
            const serialized = new FrontmatterHandler().stringify(fm, content);
            if (Buffer.byteLength(serialized, 'utf8') > SKILL_RECORD_BYTES / 2)
                throw guidanceError(Error('Skill record snapshot budget exceeded'), 'guid-697161ca4749e208');
            intent = await this.journalWrite(`${this.journalRoot(path)}${String(entries.length + 1).padStart(4, '0')}${suffix}`, {
                kind: 'intent', skillId: data.skillId, target: path, request: data.request, before: expectedRevision,
                guards: unique, dataFingerprint: fingerprint(data),
                resultRevision: createHash('sha256').update(serialized, 'utf8').digest('hex'), serialized,
            }, principal, assertActor);
        }
        const receipt = await withSkillEvolutionWrite(path, () => this.fs.writeNoteWithRevisionGuardsAndReceipt({ path, content: intent.data.serialized, expectedRevision }, unique.map(g => ({ path: g.path, expectedRevision: g.revision })), { maxGuards: 100, maxBytes: SKILL_RECORD_BYTES,
            assertAccess: async () => { await assertActor(); this.admit(path, principal); for (const g of unique)
                this.admit(g.path, principal); } }));
        if (receipt.revision !== intent.data.resultRevision)
            throw guidanceError(Error('Skill serialized write revision changed'), 'guid-791b25f0c2ae8cce');
        await this.check(intent.data.guards, principal);
        await assertActor();
        await this.journalWrite(this.commitPath(intent), { kind: 'commit', skillId: data.skillId, intent: { path: intent.path, revision: intent.revision } }, principal, assertActor);
        const result = await this.record(path, principal);
        if (result.revision !== receipt.revision)
            throw guidanceError(Error('Skill write changed during verification; reread before retrying'), 'guid-fb9e32a642bae103');
        return result;
    }
}
export function uniqueGuards(guards) {
    const map = new Map();
    for (const g of guards) {
        const prior = map.get(g.path.toLowerCase());
        if (prior && prior.revision !== g.revision)
            throw guidanceError(Error('Conflicting skill basis revisions'), 'guid-e528a64dcdb82f48');
        map.set(g.path.toLowerCase(), g);
    }
    return [...map.values()];
}
