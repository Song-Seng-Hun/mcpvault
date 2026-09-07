import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { isModerationHidden } from './moderation-policy.js';
import { normalizeSourceDerivations, traceSourceOrigins } from './source-provenance-model.js';
const BYTES = 8 * 1024 * 1024;
const UNAVAILABLE = 'Source provenance unavailable or changed; read current context and retry';
const digest = (body) => createHash('sha256').update(body).digest('hex');
export const sourceWorkIdentity = (fm) => {
    const value = fm.source_work_id ?? fm.source_family;
    return typeof value === 'string' && value.trim() && value.trim().length <= 160 ? value.trim() : undefined;
};
/** Request-local cache and revision guards, not a new index or trust authority.
 * All claims share twenty loads / sixteen MiB of retained textual payload;
 * this accounts for original/raw YAML too, not total JavaScript heap overhead. */
export class SourceProvenanceSession {
    fs;
    access;
    container;
    principal;
    notes = new Map();
    attempted = new Set();
    observed = new Map();
    bytes = 0;
    limited = false;
    constructor(fs, access, container, principal) {
        this.fs = fs;
        this.access = access;
        this.container = container;
        this.principal = principal;
    }
    physical(input) {
        if (typeof input !== 'string' || !input.trim() || input.length > 1024)
            throw Error(UNAVAILABLE);
        const raw = input.startsWith('scope://') ? this.access.resolveExternalPath(input, this.principal) : input.replace(/\\/g, '/');
        if (posix.isAbsolute(raw) || raw.includes(':') || /[\u0000-\u001f\u007f]/.test(raw))
            throw Error(UNAVAILABLE);
        const path = posix.normalize(raw);
        if (path === '..' || path.startsWith('../') || !this.allowed(path))
            throw Error(UNAVAILABLE);
        return path;
    }
    allowed(path) {
        return this.access.canAccessPhysicalPath(this.container, this.principal)
            && this.access.canAccessPhysicalPath(path, this.principal)
            && this.access.canReferenceFrom(this.container, path)
            && (!this.access.isCommunityPath(path) || this.access.isCommunityPath(this.container) || /^_scopes\//i.test(this.container));
    }
    observe(path, revision) {
        const key = path.toLowerCase(), previous = this.observed.get(key);
        if (!this.allowed(path) || (previous && previous.revision !== revision))
            throw Error(UNAVAILABLE);
        this.observed.set(key, { path, revision });
    }
    async load(input) {
        let path;
        try {
            path = this.physical(input);
        }
        catch {
            return undefined;
        }
        const key = path.toLowerCase();
        const cached = this.notes.get(key);
        if (cached)
            return cached.note;
        if (this.attempted.has(key))
            return undefined;
        if (this.attempted.size >= 20 || this.bytes >= 16 * 1024 * 1024) {
            this.limited = true;
            return undefined;
        }
        this.attempted.add(key);
        try {
            const meta = (await this.fs.readNoteMetadata([path], p => this.allowed(p), { fresh: true, strict: true, maxBytes: BYTES }))[0];
            if (!meta?.revision || isModerationHidden(meta.frontmatter))
                return undefined;
            const note = await this.fs.readNote(path, BYTES);
            if (!this.allowed(path) || isModerationHidden(note.frontmatter) || note.revision !== meta.revision)
                throw Error(UNAVAILABLE);
            this.observe(path, note.revision);
            const size = Buffer.byteLength(note.originalContent) + Buffer.byteLength(note.matter || '')
                + Buffer.byteLength(note.content) + Buffer.byteLength(JSON.stringify(note.frontmatter));
            if (this.bytes + size > 16 * 1024 * 1024) {
                this.limited = true;
                return undefined;
            }
            this.bytes += size;
            this.notes.set(key, { path, note });
            return note;
        }
        catch {
            return undefined;
        }
    }
    async trace(paths) {
        const normalized = paths.flatMap(path => { try {
            return [this.physical(path)];
        }
        catch {
            return [];
        } });
        const result = await traceSourceOrigins(normalized, async (path) => {
            const note = await this.load(path);
            if (!note || note.frontmatter.llm_wiki_type !== 'source')
                return undefined;
            const workId = sourceWorkIdentity(note.frontmatter);
            return { path: this.physical(path), revision: note.revision, ...(workId && { workId }),
                derivations: note.frontmatter.source_derivations,
                integrity: note.frontmatter.immutable === true && note.frontmatter.content_sha256 === digest(note.content) };
        });
        if (this.limited) {
            result.truncated = true;
            result.unresolved = true;
            result.status = 'partial';
        }
        // A rejected seed must not expose a path or count, nor imply complete ancestry.
        if (normalized.length !== paths.length) {
            result.unresolved = true;
            result.status = 'partial';
        }
        result.groups = result.groups.map(group => ({ ...group,
            sourcePaths: group.sourcePaths.map(path => this.access.toPublicPath(path)),
            sharedOrigins: group.sharedOrigins.map(origin => ({ ...origin, path: this.access.toPublicPath(origin.path) })),
        }));
        return result;
    }
    async validate() {
        try {
            for (const { path, revision } of this.observed.values()) {
                if (!this.allowed(path) || await this.fs.readNoteRevision(path, BYTES) !== revision)
                    throw Error(UNAVAILABLE);
            }
            if (!this.access.canAccessPhysicalPath(this.container, this.principal) || [...this.observed.values()].some(x => !this.allowed(x.path)))
                throw Error(UNAVAILABLE);
        }
        catch {
            throw Error(UNAVAILABLE);
        }
    }
}
/** Only explicit quotation/adaptation/republication records are ancestry.
 * Ordinary citations, social agreement and similarity are never promoted. */
export async function prepareSourceDerivations(fs, access, value, container, principal) {
    const records = normalizeSourceDerivations(value);
    const session = new SourceProvenanceSession(fs, access, container, principal);
    const guards = [];
    for (const record of records) {
        if (record.path.toLowerCase() === container.toLowerCase())
            throw Error(UNAVAILABLE);
        const note = await session.load(record.path);
        if (!note || note.revision !== record.revision || note.frontmatter.llm_wiki_type !== 'source'
            || note.frontmatter.immutable !== true || note.frontmatter.content_sha256 !== digest(note.content))
            throw Error(UNAVAILABLE);
        guards.push({ path: record.path, expectedRevision: record.revision });
    }
    await session.validate();
    return { records, guards };
}
