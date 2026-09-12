import { guidanceError } from './guidance-runtime.js';
import { documentMedia } from './document-resource.js';
import { documentFragmentDescriptor } from './document-service.js';
import { fingerprint } from './work-model.js';
import { documentPage, DOCUMENT_CURSOR_MAX_CHARS } from './document-page.js';
import { withDocumentWork, reserveDocumentWork } from './document-work-memory.js';
import { DocumentWorkBudgetError, createDerivedCacheOwner, derivedCacheBudget } from './cache-budget.js';
import { DocumentTopK } from './document-ranking.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const anchorOf = (row) => ({ score: row.score, path: row.publicPath, offset: row.f.startOffset });
const compareAnchors = (a, b) => b.score - a.score || a.path.localeCompare(b.path)
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.offset - b.offset;
export class DocumentSearch {
    index;
    retrieval;
    cursorSecret = randomBytes(32);
    pages = new Map();
    pageOwner = createDerivedCacheOwner('documents.search.pages');
    candidateOwner = createDerivedCacheOwner('documents.search.candidates');
    resourceCandidates;
    closed = false;
    assertOpen() { if (this.closed)
        throw new Error('Document search is closed'); }
    close() {
        this.closed = true;
        this.pages.clear();
        derivedCacheBudget.clearOwner(this.pageOwner);
        this.resourceCandidates = undefined;
        derivedCacheBudget.clearOwner(this.candidateOwner);
    }
    constructor(index, retrieval) {
        this.index = index;
        this.retrieval = retrieval;
    }
    async candidatePaths() {
        const snapshot = await this.index.catalog.allPathsSnapshot();
        this.assertOpen();
        const previous = this.resourceCandidates;
        if (previous)
            reserveDocumentWork(previous.bytes);
        if (previous?.snapshot === snapshot && previous.all.size === snapshot.length) {
            derivedCacheBudget.touch(this.candidateOwner, 'paths');
            return previous.paths;
        }
        // The catalog's immutable generation owns inventory truth. Only newly added
        // names need media classification; removals intersect the previous result.
        let bytes = 4096;
        for (const path of snapshot)
            bytes += 256 + path.length * 8;
        reserveDocumentWork(bytes);
        const all = new Set(snapshot);
        const paths = previous ? previous.paths.filter(path => all.has(path)) : [];
        for (const path of all)
            if (!previous?.all.has(path) && (documentMedia(path).text || /\.pdf$/i.test(path)))
                paths.push(path);
        paths.sort();
        const entry = { snapshot, all, paths, bytes };
        this.resourceCandidates = entry;
        derivedCacheBudget.register(this.candidateOwner, 'paths', bytes, () => { if (this.resourceCandidates === entry)
            this.resourceCandidates = undefined; });
        return paths;
    }
    cursorMac(signature, offset, anchor) {
        return createHmac('sha256', this.cursorSecret).update(JSON.stringify([signature, offset, anchor])).digest();
    }
    async search(params) {
        return withDocumentWork(() => this.searchWithinWork(params));
    }
    async searchWithinWork(params) {
        this.assertOpen();
        if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 500)
            throw guidanceError(new Error('query must contain 1..500 characters'), 'guid-d3c832557d2625c7');
        if (params.expectedRevision && !params.path)
            throw guidanceError(new Error('expectedRevision requires a target path'), 'guid-cc1aa6398d7ba677');
        if (params.resourceCursor !== undefined && (params.path || typeof params.resourceCursor !== 'string' || params.resourceCursor.length > 1000))
            throw guidanceError(new Error('Invalid resource cursor; only global discovery has resource windows'), 'guid-563d1cc3af16661f');
        const terms = [...new Set(params.query.toLowerCase().trim().split(/\s+/))];
        if (terms.length > 32)
            throw guidanceError(new Error('Search supports at most 32 terms'), 'guid-84c98edf49f577e4');
        let offset = 0, anchor;
        if (params.cursor) {
            try {
                if (typeof params.cursor !== 'string' || params.cursor.length > DOCUMENT_CURSOR_MAX_CHARS)
                    throw new Error();
                const value = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'));
                if (value.k !== 'documents.search' || !Number.isSafeInteger(value.o) || value.o < 1 || typeof value.f !== 'string'
                    || !/^[a-f0-9]{64}$/.test(value.h) || !value.a || typeof value.a.path !== 'string' || value.a.path.length > 500
                    || !Number.isFinite(value.a.score) || value.a.score <= 0 || value.a.score > 40 || !Number.isSafeInteger(value.a.offset) || value.a.offset < 0)
                    throw new Error();
                const candidate = { score: value.a.score, path: value.a.path, offset: value.a.offset };
                if (!timingSafeEqual(Buffer.from(value.h, 'hex'), this.cursorMac(value.f, value.o, candidate)))
                    throw new Error();
                offset = value.o;
                anchor = candidate;
            }
            catch {
                throw guidanceError(new Error('Cursor invalidated by changed document generation or context'), 'guid-32c2dc90208f32a4');
            }
        }
        const { reader } = this.index;
        const admitted = (path) => reader.filter.isAllowedForListing(path) && reader.access.canAccessPhysicalPath(path, params.principal)
            && (this.retrieval?.skillDiscoveryAllowed(path) ?? true);
        let candidates;
        let catalogPaths = [];
        const resourcePaths = async () => (await this.candidatePaths()).filter(path => admitted(path)
            && (!/\.(?:md|markdown)$/i.test(path) || !reader.access.canReadProtectedDocument(path)));
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
        const cacheKey = fingerprint({ resourceSignature, start, path: params.path, expectedRevision: params.expectedRevision });
        const context = (next) => ({ query: params.query, coverage: params.path ? 'current target document' : 'bounded discovery window; narrow path for exhaustive fragment search',
            completeInventory: Boolean(params.path), gaps: params.path ? [] : ['Global coverage is partial; unselected resources and unavailable parsers may contain relevant evidence.'],
            ranking: 'lexical fragments; optional semantic document candidates are advisory',
            ...(!params.path && { resourceWindow: { start, processed: next - start, fragmentsFirst: true },
                ...(next < candidates.length && { nextResourceAction: { endpointId: 'documents.search', arguments: {
                            query: params.query, resourceCursor: Buffer.from(JSON.stringify({ k: 'document-resources', f: resourceSignature, o: next })).toString('base64url'),
                            ...(params.semantic !== undefined && { semantic: params.semantic }), maxChars: params.maxChars ?? 4000,
                        } } }) }) });
        const emit = (entry) => documentPage(entry.rows.slice(offset - entry.offset), row => structuredClone(row.value), context(entry.next), entry.signature, params, 'documents.search', { offset, total: entry.total,
            cursorFields: (row, nextOffset) => ({ a: row.anchor, h: this.cursorMac(entry.signature, nextOffset, row.anchor).toString('hex') }) });
        const cached = params.cursor ? this.pages.get(cacheKey) : undefined;
        if (cached && offset >= cached.offset && offset < cached.offset + cached.rows.length) {
            reserveDocumentWork(cached.bytes);
            for (const pin of cached.pins) {
                if (!admitted(pin.path))
                    throw new Error('Document search visibility changed; repeat the query');
                await this.index.revalidatePin(pin, params.principal);
            }
            if (!params.path && fingerprint(await resourcePaths()) !== fingerprint(catalogPaths))
                throw new Error('Document search catalog changed; repeat the query');
            for (const pin of cached.pins)
                reader.assertAdmitted(reader.access.toPublicPath(pin.path), params.principal);
            this.assertOpen();
            derivedCacheBudget.touch(this.pageOwner, cacheKey);
            return emit(cached);
        }
        const ranking = new DocumentTopK(100, (a, b) => compareAnchors(anchorOf(a), anchorOf(b)));
        let total = 0;
        const generations = [];
        let bytes = 0;
        const snapshots = [];
        let next = start, cacheable = true;
        for (; next < Math.min(candidates.length, start + 48); next++) {
            if (bytes >= 16 * 1024 * 1024)
                break;
            const path = candidates[next];
            let loaded;
            try {
                loaded = await this.index.load(path, params.principal, params.expectedRevision);
            }
            catch (error) {
                if (params.path || error instanceof DocumentWorkBudgetError)
                    throw error;
                cacheable = false;
                continue;
            }
            bytes += loaded.snapshot.bytes.length;
            const doc = loaded.structure, publicPath = reader.access.toPublicPath(doc.path);
            if (!admitted(doc.path)) {
                cacheable = false;
                continue;
            }
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
            for (const f of doc.fragments) {
                if (f.children.length || f.kind === 'root' || f.kind === 'frontmatter')
                    continue;
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
                if (!score)
                    continue;
                if (++total > 50000)
                    throw guidanceError(new Error('Document match budget exceeded; narrow the query or target path'), 'guid-3b570d741924b9b6');
                const row = { doc, publicPath, f, score };
                if (!anchor || compareAnchors(anchorOf(row), anchor) > 0)
                    ranking.offer(row);
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
        this.assertOpen();
        const items = ranking.sorted();
        const signature = fingerprint({ generations, resourceSignature, start, next, query: params.query, path: params.path, semantic: params.semantic === true,
            principal: params.principal ?? null });
        // Reserve a conservative bound before projecting at most 100 short descriptors.
        const pageBytes = items.length * 16384 + snapshots.length * 4096 + 4096;
        reserveDocumentWork(pageBytes);
        const rows = items.map(({ doc, publicPath, f, score }) => ({ anchor: { score, path: publicPath, offset: f.startOffset }, value: { path: publicPath, revision: doc.revision, profile: doc.profile,
                ...documentFragmentDescriptor(f), score, ...(doc.locator && { locator: doc.locator }),
                readAction: { endpointId: 'documents.read', arguments: { path: publicPath, expectedRevision: doc.revision, fragmentId: f.id, maxChars: 4000 } } } }));
        // Clone before retention, not only delivery: V8 substrings can otherwise
        // keep a complete original string alive behind a tiny reference/label.
        const entry = { rows: structuredClone(rows), pins: snapshots.map(snapshot => reader.pin(snapshot)), signature, offset, total, next, bytes: pageBytes };
        const result = emit(entry);
        // A failed/unadmitted candidate has no validated generation pin. Recompute
        // such windows so a repaired source cannot hide behind a warm cursor.
        if (!cacheable) {
            this.pages.delete(cacheKey);
            derivedCacheBudget.remove(this.pageOwner, cacheKey);
            return result;
        }
        if (this.pages.size >= 8 && !this.pages.has(cacheKey)) {
            const oldest = this.pages.keys().next().value;
            this.pages.delete(oldest);
            derivedCacheBudget.remove(this.pageOwner, oldest);
        }
        this.pages.set(cacheKey, entry);
        derivedCacheBudget.register(this.pageOwner, cacheKey, pageBytes, () => this.pages.delete(cacheKey));
        return result;
    }
}
