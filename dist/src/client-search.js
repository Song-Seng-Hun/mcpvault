const MAX_QUERY_CHARS = 500;
const MAX_RESULT_LIMIT = 50;
const MAX_INDEXED_DOCUMENTS = 5_000;
function normalize(value) {
    return value.normalize('NFKC').toLocaleLowerCase();
}
function terms(value) {
    const normalized = normalize(value).trim();
    const words = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];
    const grams = [];
    for (const word of words) {
        if (word.length < 2)
            continue;
        for (let index = 0; index < word.length - 1; index += 1)
            grams.push(word.slice(index, index + 2));
    }
    return [...new Set([...words, ...grams])];
}
function excerpt(text, query, maxChars) {
    const compact = text.replace(/\s+/g, ' ').trim();
    const position = normalize(compact).indexOf(normalize(query));
    const start = Math.max(0, position < 0 ? 0 : position - Math.floor(maxChars / 3));
    const clipped = compact.slice(start, start + maxChars);
    return `${start > 0 ? '…' : ''}${clipped}${start + clipped.length < compact.length ? '…' : ''}`;
}
/**
 * Lightweight host-side first-pass search over explicitly cached notes. It is
 * an optimization only: callers must use the server search/revision contract
 * before treating a result as current or authoritative.
 */
export class McpVaultClientSearchIndex {
    documents = new Map();
    searchCache = new Map();
    maxDocuments;
    constructor(options = {}) {
        const maxDocuments = options.maxDocuments ?? MAX_INDEXED_DOCUMENTS;
        if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > MAX_INDEXED_DOCUMENTS)
            throw new Error(`maxDocuments must be between 1 and ${MAX_INDEXED_DOCUMENTS}`);
        this.maxDocuments = maxDocuments;
    }
    upsert(note) {
        const content = `${note.path}\n${note.content || ''}\n${note.frontmatter ? JSON.stringify(note.frontmatter) : ''}`;
        this.documents.set(note.path, {
            note: { ...note, ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }) },
            searchable: normalize(content),
            title: normalize(note.path.split('/').pop()?.replace(/\.(?:md|markdown|txt)$/i, '') || note.path),
        });
        this.searchCache.clear();
        while (this.documents.size > this.maxDocuments)
            this.documents.delete(this.documents.keys().next().value);
    }
    remove(path) {
        this.documents.delete(path);
        this.searchCache.clear();
    }
    clear() {
        this.documents.clear();
        this.searchCache.clear();
    }
    size() {
        return this.documents.size;
    }
    values() {
        return [...this.documents.values()].map(document => ({
            ...document.note,
            ...(document.note.frontmatter && { frontmatter: { ...document.note.frontmatter } }),
        }));
    }
    snapshot() {
        return JSON.stringify(this.values());
    }
    restore(snapshot) {
        let parsed;
        try {
            parsed = JSON.parse(snapshot);
        }
        catch {
            return 0;
        }
        if (!Array.isArray(parsed))
            return 0;
        let restored = 0;
        for (const value of parsed) {
            if (!value || typeof value !== 'object')
                continue;
            const note = value;
            if (typeof note.path !== 'string' || !note.path || typeof note.revision !== 'string' || !note.revision)
                continue;
            this.upsert({
                path: note.path,
                revision: note.revision,
                ...(typeof note.content === 'string' && { content: note.content }),
                ...(note.frontmatter && typeof note.frontmatter === 'object' && { frontmatter: note.frontmatter }),
                ...(typeof note.obsidianUri === 'string' && { obsidianUri: note.obsidianUri }),
            });
            restored += 1;
        }
        return restored;
    }
    persist(store, key) {
        store.setItem(key, this.snapshot());
    }
    hydrate(store, key) {
        const snapshot = store.getItem(key);
        return snapshot ? this.restore(snapshot) : 0;
    }
    search(query, options = {}) {
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery)
            throw new Error('query is required');
        if (normalizedQuery.length > MAX_QUERY_CHARS)
            throw new Error(`query cannot exceed ${MAX_QUERY_CHARS} characters`);
        const cacheKey = JSON.stringify({ query: normalizedQuery, limit: options.limit, maxChars: options.maxChars });
        const cached = this.searchCache.get(cacheKey);
        if (cached)
            return cloneSearchResponse(cached);
        const queryTerms = terms(normalizedQuery);
        if (queryTerms.length === 0)
            return { complete: false, indexedDocuments: this.documents.size, results: [] };
        const limit = Math.min(Math.max(Math.floor(options.limit ?? 5), 1), MAX_RESULT_LIMIT);
        const maxChars = Math.min(Math.max(Math.floor(options.maxChars ?? 240), 80), 2000);
        const ranked = [];
        for (const document of this.documents.values()) {
            let score = 0;
            for (const term of queryTerms) {
                let position = 0;
                let count = 0;
                while ((position = document.searchable.indexOf(term, position)) !== -1) {
                    count += 1;
                    position += term.length;
                }
                score += count;
                if (document.title.includes(term))
                    score += 5;
            }
            if (document.searchable.includes(normalize(normalizedQuery)))
                score += 4;
            if (score === 0)
                continue;
            ranked.push({ path: document.note.path, score, excerpt: excerpt(document.note.content || document.searchable, normalizedQuery, maxChars), revision: document.note.revision });
        }
        ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        const result = { complete: false, indexedDocuments: this.documents.size, results: ranked.slice(0, limit) };
        this.searchCache.set(cacheKey, cloneSearchResponse(result));
        while (this.searchCache.size > 128)
            this.searchCache.delete(this.searchCache.keys().next().value);
        return result;
    }
}
function cloneSearchResponse(value) {
    return { ...value, results: value.results.map(result => ({ ...result })) };
}
