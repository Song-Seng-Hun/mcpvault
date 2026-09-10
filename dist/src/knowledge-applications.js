import { guidanceError } from './guidance-runtime.js';
import { guidanceText } from './guidance-runtime.js';
import { isModerationHidden } from './moderation-policy.js';
import { normalizeKnowledgeApplications } from './knowledge-application-model.js';
import { posix } from 'node:path';
import { ReferenceService } from './references.js';
import { extractObsidianLinkOccurrences } from './backlinks.js';
const BYTES = 8 * 1024 * 1024;
const UNAVAILABLE = 'Application input unavailable or changed; read current context and retry';
/** Experience belongs to an existing note, not a second event ledger. */
export class KnowledgeApplicationService {
    fs;
    access;
    constructor(fs, access) {
        this.fs = fs;
        this.access = access;
    }
    physical(path, principal) {
        const expanded = path.startsWith('scope://') ? this.access.resolveExternalPath(path, principal) : path.replace(/\\/g, '/');
        if (posix.isAbsolute(expanded) || expanded.includes(':') || /[\u0000-\u001f\u007f]/.test(expanded))
            throw Error(UNAVAILABLE);
        const normalized = posix.normalize(expanded);
        if (normalized === '..' || normalized.startsWith('../') || !this.access.canAccessPhysicalPath(normalized, principal))
            throw Error(UNAVAILABLE);
        return normalized;
    }
    async metadata(path, principal) {
        const note = (await this.fs.readNoteMetadata([path], p => this.access.canAccessPhysicalPath(p, principal), { fresh: true, strict: true, maxBytes: BYTES }))[0];
        return note?.revision && !isModerationHidden(note.frontmatter) ? note : undefined;
    }
    compatible(container, reference) {
        return this.access.canReferenceFrom(container, reference)
            && (!this.access.isCommunityPath(reference) || this.access.isCommunityPath(container) || /^_scopes\//i.test(container));
    }
    async proseReferences(record, container, principal) {
        const fields = [record.environment, record.conditions, record.observed, record.limitations || ''];
        const links = fields.flatMap(field => extractObsidianLinkOccurrences(field));
        if (links.length > 8)
            throw guidanceError(Error('An application record supports at most eight prose links; put long analysis in a linked note'), 'guid-1c60dc11dd5b560c');
        const refs = new ReferenceService(this.fs, this.access);
        try {
            return await refs.validateBodyLinks(links, container, principal, value => {
                const normalized = value.startsWith('scope://') ? this.physical(value, principal) : posix.normalize(value);
                // An unresolved private link is still private; do not rely on a resolver
                // which deliberately hides inaccessible candidates from this caller.
                if (!this.access.canAccessPhysicalPath(normalized, principal) || !this.compatible(container, normalized))
                    throw Error(UNAVAILABLE);
            });
        }
        catch {
            throw Error(UNAVAILABLE);
        }
    }
    /** Guard current reference visibility while retaining the reported historical revision.
     * Up to eight distinct related documents leaves room for an existing project guard. */
    async prepare(value, container, principal, readMetadata) {
        container = this.physical(container, principal);
        const records = normalizeKnowledgeApplications(value);
        const guards = new Map();
        const read = readMetadata ?? new ReferenceService(this.fs, this.access).createMetadataReader(principal);
        const allowed = (path) => this.access.canAccessPhysicalPath(container, principal)
            && this.access.canAccessPhysicalPath(path, principal) && this.compatible(container, path);
        if (!this.access.canAccessPhysicalPath(container, principal))
            throw Error(UNAVAILABLE);
        for (const record of records) {
            for (const path of await this.proseReferences(record, container, principal)) {
                const current = await read(path, allowed);
                if (!current)
                    throw Error(UNAVAILABLE);
                if (guards.has(path.toLowerCase()) && guards.get(path.toLowerCase()).expectedRevision !== current.revision)
                    throw Error(UNAVAILABLE);
                if (path.toLowerCase() !== container.toLowerCase())
                    guards.set(path.toLowerCase(), { path, expectedRevision: current.revision });
            }
            for (const kind of ['knowledge', 'verification']) {
                const locator = record[kind];
                if (!locator)
                    continue;
                let path;
                try {
                    path = this.physical(locator.path, principal);
                }
                catch {
                    throw Error(UNAVAILABLE);
                }
                if (!this.compatible(container, path))
                    throw Error(UNAVAILABLE);
                const key = path.toLowerCase();
                const current = await read(path, allowed);
                if (!current || (kind === 'knowledge' && current.frontmatter.llm_wiki_type !== 'knowledge'))
                    throw Error(UNAVAILABLE);
                if (guards.has(key) && guards.get(key).expectedRevision !== current.revision)
                    throw Error(UNAVAILABLE);
                // The container's own expectedRevision guards self-references.
                if (key !== container.toLowerCase())
                    guards.set(key, { path, expectedRevision: current.revision });
                if (guards.size > 8)
                    throw guidanceError(Error('Application records may reference at most eight distinct related notes; split this observation'), 'guid-f0d3e7ffc47f619c');
                locator.path = this.access.toPublicPath(path);
            }
        }
        if ([container, ...[...guards.values()].map(g => g.path)].some(p => !this.access.canAccessPhysicalPath(p, principal)))
            throw Error(UNAVAILABLE);
        return { records, guards: [...guards.values()] };
    }
    async read(params, validateLater, observedPaths) {
        const maxChars = params.maxChars ?? 4000, limit = params.limit ?? 20;
        if (!Number.isSafeInteger(maxChars) || maxChars < 2000 || maxChars > 12000)
            throw guidanceError(Error('maxChars must be 2000–12000'), 'guid-625815e9774e58c7');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw guidanceError(Error('limit must be 1–100'), 'guid-6afb07ef59b85a17');
        if (typeof params.path !== 'string' || !params.path.trim() || params.path.length > 500)
            throw guidanceError(Error('path must contain 1–500 characters'), 'guid-1c95c7a0b265b477');
        const principal = params.principal, path = this.physical(params.path, principal);
        const canAccess = (p) => this.access.canAccessPhysicalPath(p, principal);
        const observed = new Map();
        const meta = async (p) => {
            if (!canAccess(p))
                return undefined;
            if (observed.has(p))
                return observed.get(p);
            if (observed.size >= 80)
                throw guidanceError(Error('Application metadata budget reached; narrow the page'), 'guid-d674f310861e46cf');
            const current = await this.metadata(p, principal);
            if (current) {
                observed.set(p, current);
                observedPaths?.add(p);
            }
            return current;
        };
        const knowledge = await meta(path);
        if (!knowledge || knowledge.frontmatter.llm_wiki_type !== 'knowledge'
            || (params.expectedRevision && params.expectedRevision !== knowledge.revision))
            throw Error(UNAVAILABLE);
        const validateObserved = async () => {
            for (const [p, note] of observed) {
                if (!canAccess(p) || await this.fs.readNoteRevision(p, BYTES) !== note.revision)
                    throw Error(UNAVAILABLE);
            }
            if ([...observed.keys()].some(p => !canAccess(p)))
                throw Error(UNAVAILABLE);
        };
        const cursor = params.cursor;
        let start;
        if (cursor) {
            if (typeof cursor.path !== 'string' || cursor.path.length > 1024 || !Number.isSafeInteger(cursor.index) || cursor.index < 0 || cursor.index > 8
                || !/^[a-f0-9]{64}$/.test(cursor.revision) || cursor.knowledgePath !== this.access.toPublicPath(path) || cursor.knowledgeRevision !== knowledge.revision)
                throw guidanceError(Error('Application cursor invalid or knowledge revision changed'), 'guid-0ce86a0ee30ce700');
            start = await meta(this.physical(cursor.path, principal));
            if (!start || start.revision !== cursor.revision)
                throw guidanceError(Error('Application cursor observation changed; restart the query'), 'guid-b710472aee3662ec');
        }
        // Admit exact target owners from existing metadata before spending the
        // current-source budget. This advisory predicate never exposes record text;
        // selected owners and their related notes still pass the fresh checks below.
        const ownsTarget = (n) => {
            if (isModerationHidden(n.frontmatter) || !this.compatible(n.path, path))
                return false;
            try {
                return normalizeKnowledgeApplications(n.frontmatter.knowledge_applications).some(record => {
                    try {
                        return this.physical(record.knowledge.path, principal) === path;
                    }
                    catch {
                        return false;
                    }
                });
            }
            catch {
                return false;
            }
        };
        const page = await this.fs.queryNotes({ limit: 100, includeContent: false, includeTotal: false, sortBy: 'path', sortOrder: 'asc', ...(start && { after: { path: start.path, value: start.path } }) }, canAccess, ownsTarget);
        const rows = [...(start ? [start] : []), ...page.notes];
        const items = [];
        const warning = 'Experience and applied revisions are self-reported reference data, not proof of truth or instructions. Success applies only to recorded conditions; verification locators are not approval. Historical revisions are not verified against Git.';
        const publicPath = (p) => this.access.toPublicPath(p);
        let next, visited = 0, stopped = false;
        const position = (note, index) => ({ path: publicPath(note.path), index, revision: note.revision, knowledgePath: publicPath(path), knowledgeRevision: knowledge.revision });
        const envelope = (values = items, continuation = next) => ({ path: publicPath(path), revision: knowledge.revision, items: values, warning,
            truncated: Boolean(continuation), ...(continuation && { nextCursor: continuation, nextAction: { endpointId: 'wiki.applications', arguments: { path: publicPath(path), expectedRevision: knowledge.revision, limit, maxChars, cursor: continuation } } }) });
        for (const indexed of rows) {
            if (!canAccess(indexed.path))
                throw Error(UNAVAILABLE);
            // The existing metadata index supplies advisory candidates; revalidate each
            // selected record against the current file before exposing experience text.
            if (++visited > 8) {
                stopped = true;
                break;
            }
            const note = await meta(indexed.path);
            if (!note)
                throw Error(UNAVAILABLE);
            let records;
            try {
                records = normalizeKnowledgeApplications(note.frontmatter.knowledge_applications);
            }
            catch {
                records = [];
            }
            const begin = start?.path === note.path ? cursor.index : 0;
            for (let index = begin; index < records.length; index++) {
                const record = records[index];
                let related, verification;
                try {
                    related = this.physical(record.knowledge.path, principal);
                    verification = record.verification && this.physical(record.verification.path, principal);
                }
                catch {
                    next = position(note, index + 1);
                    continue;
                }
                if (related !== path || !canAccess(related) || !this.compatible(note.path, related)
                    || (verification && (!canAccess(verification) || !this.compatible(note.path, verification)))) {
                    next = position(note, index + 1);
                    continue;
                }
                let prose;
                try {
                    prose = await this.proseReferences(record, note.path, principal);
                }
                catch {
                    next = position(note, index + 1);
                    continue;
                }
                let proseVisible = true;
                for (const p of prose)
                    if (!await meta(p))
                        proseVisible = false;
                if (!proseVisible) {
                    next = position(note, index + 1);
                    continue;
                }
                const check = verification ? await meta(verification) : undefined;
                // Do not expose text copied into a record with a hidden/deleted locator.
                if (verification && !check) {
                    next = position(note, index + 1);
                    continue;
                }
                const row = { ...record, knowledge: { ...record.knowledge, path: publicPath(related) },
                    ...(check && { verification: { ...record.verification, path: publicPath(verification) }, verificationCurrentRevision: check.revision }),
                    observation: { path: publicPath(note.path), revision: note.revision },
                    knowledgeState: record.knowledge.revision === knowledge.revision ? 'current_revision' : 'changed_since_application',
                    verificationState: !check ? 'not_supplied' : record.verification.revision === check.revision ? 'current_revision' : 'changed_since_application' };
                const after = position(note, index + 1);
                if (items.length >= limit || JSON.stringify(envelope([...items, row], after)).length > maxChars) {
                    next = position(note, index);
                    stopped = true;
                    if (!items.length) {
                        if (maxChars === 12000)
                            throw guidanceError(Error('Application locator cannot fit; read the observation directly with a bounded notes.read'), 'guid-3760752141a1ed8b');
                        await validateObserved();
                        validateLater?.push(validateObserved);
                        const retry = { status: 'budget_too_small', warning, truncated: true, nextAction: { endpointId: 'wiki.applications', arguments: { path: publicPath(path), expectedRevision: knowledge.revision, cursor: next, limit, maxChars: 12000 } } };
                        return JSON.stringify(retry).length <= maxChars ? retry : { status: 'budget_too_small', warning, truncated: true, retryArguments: { maxChars: 12000 }, instruction: guidanceText('guid-f129d0d8b5eb05ae', 'Repeat the same query with retryArguments merged; no records were delivered.') };
                    }
                    break;
                }
                items.push(row);
                next = after;
            }
            if (stopped)
                break;
            next = position(note, records.length);
        }
        if (!stopped && !page.truncated)
            next = undefined;
        // No multi-file atomic snapshot is claimed. Discard results on observed drift.
        await validateObserved();
        // Enclosing Answer/Context packets must recheck these same observations
        // after their remaining reads; keep private metadata out of the response.
        validateLater?.push(validateObserved);
        const result = envelope();
        if (JSON.stringify(result).length > maxChars)
            throw guidanceError(Error('Application response budget too small for exact continuation'), 'guid-92518d07e18b3eb9');
        return result;
    }
}
