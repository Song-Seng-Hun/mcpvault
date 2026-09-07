import { boundSearchResults, normalizeSearchMaxChars, normalizeSearchLimit } from './search-limits.js';
import { isModerationHidden } from './moderation-policy.js';
import { selectContextPassages } from './context-passages.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { posix } from 'node:path';
import { positiveSearchTerms } from './search.js';
export const RETRIEVAL_NOTE_BYTES = 8 * 1024 * 1024;
export function constrainedQuery(query) {
    return /["'\[\]:()]|(?:^|\s)-\S|(?:^|\s)OR(?:\s|$)/i.test(query);
}
export function plainQueryExpansion(query) {
    if (constrainedQuery(query))
        return;
    const terms = [...new Set(query.trim().replace(/[?？]+$/, '').split(/\s+/))];
    if (terms.length < 2 || terms.length > 12 || terms.some(t => !/^[\p{L}\p{N}_]+$/u.test(t)))
        return;
    return terms.join(' OR ');
}
export function bodyStartLine(note) {
    const suffix = note.originalContent.length - note.content.length;
    return note.originalContent.slice(0, Math.max(0, suffix)).split('\n').length;
}
export function passageAction(path, revision, startLine, endLine) {
    return { endpointId: endpointIdForTool('read_note_lines'), arguments: { path, startLine, endLine, expectedRevision: revision, maxChars: 4000 } };
}
/** Shared adapter-independent retrieval. Indexes discover; current Markdown
 * supplies excerpt content. No persistent question/answer cache or model. */
export class RetrievalService {
    search;
    collaboration;
    semantic;
    access;
    fs;
    constructor(search, collaboration, semantic, access, fs) {
        this.search = search;
        this.collaboration = collaboration;
        this.semantic = semantic;
        this.access = access;
        this.fs = fs;
    }
    physical(hit, principal) {
        const raw = hit.physicalPath || hit.p;
        const expanded = raw.startsWith('scope://') ? this.access.resolveExternalPath(raw, principal) : raw.replace(/\\/g, '/');
        if (posix.isAbsolute(expanded) || expanded.includes(':'))
            throw new Error('Search target is unavailable');
        const path = posix.normalize(expanded);
        if (path === '..' || path.startsWith('../'))
            throw new Error('Search target is unavailable');
        if (!this.access.canAccessPhysicalPath(path, principal))
            throw new Error('Search target is unavailable');
        return path;
    }
    async retrieve(params, allowExpansion = false) {
        // Runtime payloads are not typed: only the authenticated principal supplies identity.
        const safe = { query: params.query };
        for (const key of ['limit', 'maxChars', 'searchContent', 'searchFrontmatter', 'caseSensitive', 'includeRevisions', 'expandAuthority', 'excludePaths']) {
            if (params[key] !== undefined)
                Object.assign(safe, { [key]: params[key] });
        }
        const lexical = async (query) => {
            if (params.pathPrefix) {
                const prefix = this.physical({ p: params.pathPrefix }, params.principal);
                const excludePaths = [...(safe.excludePaths || []), ...(prefix.toLowerCase().startsWith('_scopes/') ? [] : ['_scopes']), '_whispers'];
                return (await this.search.search({ ...safe, query, pathPrefix: prefix === '.' ? '' : prefix, excludePaths, canAccessPath: path => this.access.canAccessPhysicalPath(path, params.principal) }))
                    .filter(hit => this.access.canAccessPhysicalPath(hit.p, params.principal));
            }
            return this.collaboration.searchScopedNotes({ ...safe, query, ...(params.principal?.modelId && { modelId: params.principal.modelId }), ...(params.principal?.agentId && { agentId: params.principal.agentId }) }, path => this.access.canAccessPhysicalPath(path, params.principal));
        };
        let usedQuery = params.query;
        let results = await lexical(usedQuery);
        let expanded = false;
        if (!results.length && allowExpansion) {
            const expansion = plainQueryExpansion(usedQuery);
            if (expansion) {
                usedQuery = expansion;
                results = await lexical(usedQuery);
                expanded = true;
            }
        }
        let semantic = { state: 'disabled' };
        if (params.semantic === true) {
            // Preserve exact phrases and exclusions as well as structured filters.
            if (constrainedQuery(params.query))
                semantic = { state: 'filtered' };
            else {
                let timer;
                let outcome;
                try {
                    outcome = await Promise.race([
                        this.semantic.search({ ...safe, ...(params.pathPrefix !== undefined && { pathPrefix: params.pathPrefix }), ...(params.queryVector !== undefined && { queryVector: params.queryVector }), ...(params.principal && { principal: params.principal }) }),
                        new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 2000); timer.unref?.(); }),
                    ]);
                }
                catch { /* Optional backend failures never erase lexical results. */ }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
                semantic = { state: outcome?.available ? 'available' : 'unavailable' };
                const byPath = new Map(results.map(hit => [this.physical(hit, params.principal), hit]));
                for (const hit of outcome?.results || []) {
                    if (!this.access.canAccessPhysicalPath(hit.p, params.principal))
                        continue;
                    const physical = this.physical(hit, params.principal);
                    const prior = byPath.get(physical);
                    byPath.set(physical, prior ? { ...prior, vs: true, why: [...new Set([...(prior.why || []), 'semantic_match'])] } : hit);
                }
                results = [...byPath.values()].sort((a, b) => Number(Boolean(b.wk)) - Number(Boolean(a.wk))).slice(0, normalizeSearchLimit(params.limit));
                results = boundSearchResults(results, normalizeSearchMaxChars(params.maxChars));
            }
        }
        if (allowExpansion) {
            const terms = positiveSearchTerms(params.query).map(t => t.toLocaleLowerCase());
            const score = (hit) => {
                const preview = `${hit.t}\n${hit.ex}`.toLocaleLowerCase();
                return terms.reduce((n, term) => n + Number(preview.includes(term)), 0);
            };
            // Only query packets favor candidate previews covering more of the question;
            // ordinary search ordering and its compact compatibility contract stay intact.
            results = [...results].sort((a, b) => Number(Boolean(b.wk)) - Number(Boolean(a.wk)) || score(b) - score(a));
        }
        return { results, usedQuery, expanded, semantic };
    }
    async searchNotes(params) {
        if (params.excerptMode !== undefined && !['compact', 'context'].includes(params.excerptMode))
            throw new Error('Invalid excerptMode');
        const outcome = await this.retrieve(params);
        let results = outcome.results;
        if (params.excerptMode === 'context') {
            const expanded = [];
            for (const hit of results) {
                const path = this.physical(hit, params.principal);
                const metadata = (await this.fs.readNoteMetadata([path], p => this.access.canAccessPhysicalPath(p, params.principal), { fresh: true, strict: true, maxBytes: RETRIEVAL_NOTE_BYTES }))[0];
                if (!metadata || isModerationHidden(metadata.frontmatter))
                    continue;
                const note = await this.fs.readNote(path, RETRIEVAL_NOTE_BYTES);
                if (isModerationHidden(note.frontmatter))
                    continue;
                if (metadata.revision !== note.revision || (hit.rv && hit.rv !== note.revision))
                    throw new Error('Search context changed; repeat the same query');
                const chosen = selectContextPassages({ content: note.content, query: params.query, maxChars: 350, maxPassages: 1, startLine: bodyStartLine(note), ...(hit.ln && { preferredLine: hit.ln }) });
                const passage = chosen.passages[0];
                if (!this.access.canAccessPhysicalPath(path, params.principal) || await this.fs.readNoteRevision(path, RETRIEVAL_NOTE_BYTES) !== note.revision)
                    throw new Error('Search context changed; repeat the same query');
                const publicPath = this.access.toPublicPath(path);
                expanded.push({ ...hit, p: publicPath, rv: note.revision,
                    ex: passage?.text || '', ln: passage?.startLine || 0,
                    context: { headingPath: passage?.headingPath || [], truncated: chosen.truncated, ...(passage && { endLine: passage.endLine }) },
                    nextAction: passage ? passageAction(publicPath, note.revision, passage.startLine, passage.endLine)
                        : { endpointId: endpointIdForTool('get_note_outline'), arguments: { path: publicPath, expectedRevision: note.revision } },
                });
            }
            results = boundSearchResults(expanded, normalizeSearchMaxChars(params.maxChars));
        }
        this.search.recordUsage(params.principal?.accountId || params.principal?.agentId || 'anonymous', params.query, results.length);
        return results;
    }
}
