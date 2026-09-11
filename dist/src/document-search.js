import { guidanceError } from './guidance-runtime.js';
import { documentMedia } from './document-resource.js';
import { documentFragmentDescriptor } from './document-service.js';
import { fingerprint } from './work-model.js';
import { documentPage } from './document-page.js';
export class DocumentSearch {
    index;
    retrieval;
    constructor(index, retrieval) {
        this.index = index;
        this.retrieval = retrieval;
    }
    async search(params) {
        if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 500)
            throw guidanceError(new Error('query must contain 1..500 characters'), 'guid-d3c832557d2625c7');
        if (params.expectedRevision && !params.path)
            throw guidanceError(new Error('expectedRevision requires a target path'), 'guid-cc1aa6398d7ba677');
        if (params.resourceCursor !== undefined && (params.path || typeof params.resourceCursor !== 'string' || params.resourceCursor.length > 1000))
            throw guidanceError(new Error('Invalid resource cursor; only global discovery has resource windows'), 'guid-563d1cc3af16661f');
        const terms = [...new Set(params.query.toLowerCase().trim().split(/\s+/))];
        if (terms.length > 32)
            throw guidanceError(new Error('Search supports at most 32 terms'), 'guid-84c98edf49f577e4');
        const { reader } = this.index;
        const admitted = (path) => reader.filter.isAllowedForListing(path) && reader.access.canAccessPhysicalPath(path, params.principal)
            && (this.retrieval?.skillDiscoveryAllowed(path) ?? true);
        let candidates;
        let catalogPaths = [];
        const resourcePaths = async () => (await this.index.catalog.allPathsSnapshot()).filter(path => admitted(path) && !/\.(?:md|markdown)$/i.test(path)
            && (documentMedia(path).text || /\.pdf$/i.test(path))).sort();
        if (params.path) {
            const path = reader.resolve(params.path, params.principal);
            if (!admitted(path))
                throw guidanceError(new Error('Document unavailable'), 'guid-9ef06b8861d9b3c6');
            candidates = [params.path];
        }
        else {
            if (!this.index.catalog || !this.retrieval)
                throw guidanceError(new Error('Global document discovery unavailable; provide path'), 'guid-ed66bc161c65360b');
            const hits = await this.retrieval.searchNotes({ query: params.query, limit: 24, maxChars: 12000, includeRevisions: true,
                semantic: params.semantic === true, canAccessPath: admitted, ...(params.principal && { principal: params.principal }) });
            catalogPaths = await resourcePaths();
            // Bounded candidate discovery is explicitly NOT a whole-Vault completeness claim.
            candidates = [...new Set([...hits.map(hit => hit.p), ...catalogPaths.map(path => reader.access.toPublicPath(path))])];
        }
        const resourceSignature = fingerprint({ candidates, query: params.query, semantic: params.semantic === true, principal: params.principal ?? null });
        let start = 0;
        if (params.resourceCursor !== undefined) {
            try {
                const value = JSON.parse(Buffer.from(params.resourceCursor, 'base64url').toString('utf8'));
                if (value.k !== 'document-resources' || value.f !== resourceSignature || !Number.isSafeInteger(value.o) || value.o < 0 || value.o >= candidates.length)
                    throw new Error();
                start = value.o;
            }
            catch {
                throw guidanceError(new Error('Resource cursor invalidated by changed authorized catalog or query context'), 'guid-7fc3ea64415a9170');
            }
        }
        const items = [];
        const generations = [];
        let bytes = 0;
        const snapshots = [];
        let next = start;
        for (; next < Math.min(candidates.length, start + 48); next++) {
            if (bytes >= 16 * 1024 * 1024)
                break;
            const path = candidates[next];
            let loaded;
            try {
                loaded = await this.index.load(path, params.principal, params.expectedRevision);
            }
            catch (error) {
                if (params.path)
                    throw error;
                continue;
            }
            bytes += loaded.snapshot.bytes.length;
            const doc = loaded.structure, publicPath = reader.access.toPublicPath(doc.path);
            if (!admitted(doc.path))
                continue;
            snapshots.push(loaded.snapshot);
            generations.push({ path: publicPath, revision: doc.revision, profile: doc.profile });
            const headingMatches = new Map();
            const matchedHeading = (heading) => {
                let matches = headingMatches.get(heading);
                if (!matches) {
                    const lower = heading.toLowerCase();
                    matches = terms.map(term => lower.includes(term));
                    headingMatches.set(heading, matches);
                }
                return matches;
            };
            const matches = doc.fragments.filter(f => !f.children.length && !['root', 'frontmatter'].includes(f.kind)).map(f => {
                const text = doc.raw.slice(f.startOffset, f.endOffset).toLowerCase();
                const heading = f.headingPath.map(matchedHeading);
                let score = 0;
                for (let i = 0; i < terms.length; i++) {
                    const inHeading = heading.some(matches => matches[i]);
                    if (inHeading || text.includes(terms[i]))
                        score++;
                    if (inHeading)
                        score += 0.25;
                }
                return { f, score };
            }).filter(m => m.score > 0).sort((a, b) => b.score - a.score || a.f.startOffset - b.f.startOffset);
            for (const { f, score } of matches) {
                if (items.length >= 50000)
                    throw guidanceError(new Error('Document match budget exceeded; narrow the query or target path'), 'guid-3b570d741924b9b6');
                items.push({ doc, publicPath, f, score });
            }
        }
        // Counts and pagination describe one revalidated generation, not whichever
        // earlier sources happened to be readable before a later await.
        for (const snapshot of snapshots) {
            if (!admitted(snapshot.path))
                throw guidanceError(new Error('Document search visibility changed; repeat the query'), 'guid-3fc1b15902289614');
            await reader.assertCurrent(snapshot, params.principal);
        }
        if (!params.path && fingerprint(await resourcePaths()) !== fingerprint(catalogPaths))
            throw guidanceError(new Error('Document search catalog changed; repeat the query'), 'guid-e8a785c8d7869c14');
        for (const snapshot of snapshots)
            if (!admitted(snapshot.path))
                throw guidanceError(new Error('Document search visibility changed; repeat the query'), 'guid-3fc1b15902289614');
        items.sort((a, b) => b.score - a.score || a.publicPath.localeCompare(b.publicPath) || a.f.startOffset - b.f.startOffset);
        const context = { query: params.query, coverage: params.path ? 'current target document' : 'bounded discovery window; narrow path for exhaustive fragment search',
            completeInventory: Boolean(params.path), gaps: params.path ? [] : ['Global coverage is partial; unselected resources and unavailable parsers may contain relevant evidence.'],
            ranking: 'lexical fragments; optional semantic document candidates are advisory',
            ...(!params.path && { resourceWindow: { start, processed: next - start, fragmentsFirst: true },
                ...(next < candidates.length && { nextResourceAction: { endpointId: 'documents.search', arguments: {
                            query: params.query, resourceCursor: Buffer.from(JSON.stringify({ k: 'document-resources', f: resourceSignature, o: next })).toString('base64url'),
                            ...(params.semantic !== undefined && { semantic: params.semantic }), maxChars: params.maxChars ?? 4000,
                        } } }) }) };
        return documentPage(items, ({ doc, publicPath, f, score }) => ({ path: publicPath, revision: doc.revision, profile: doc.profile,
            ...documentFragmentDescriptor(f), score, ...(doc.locator && { locator: doc.locator }),
            readAction: { endpointId: 'documents.read', arguments: { path: publicPath, expectedRevision: doc.revision, fragmentId: f.id, maxChars: 4000 } } }), context, fingerprint({ generations, resourceSignature, start, next, query: params.query, path: params.path, semantic: params.semantic === true,
            principal: params.principal ?? null }), params, 'documents.search');
    }
}
