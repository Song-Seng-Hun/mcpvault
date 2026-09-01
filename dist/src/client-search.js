const MAX_QUERY_CHARS = 500;
const MAX_RESULT_LIMIT = 50;
const MAX_INDEXED_DOCUMENTS = 5_000;
const MAX_TOKENS_PER_DOCUMENT = 4_096;
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
function tokenCounts(value) {
    const normalized = normalize(value);
    const counts = new Map();
    const words = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];
    const add = (token) => {
        if (!counts.has(token) && counts.size >= MAX_TOKENS_PER_DOCUMENT)
            return false;
        counts.set(token, (counts.get(token) || 0) + 1);
        return true;
    };
    for (const word of words) {
        if (!add(word))
            break;
        if (word.length < 2)
            continue;
        for (let index = 0; index < word.length - 1 && counts.size < MAX_TOKENS_PER_DOCUMENT; index += 1) {
            const gram = word.slice(index, index + 2);
            add(gram);
        }
    }
    return counts;
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
    postings = new Map();
    searchCache = new Map();
    maxDocuments;
    constructor(options = {}) {
        const maxDocuments = options.maxDocuments ?? MAX_INDEXED_DOCUMENTS;
        if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > MAX_INDEXED_DOCUMENTS)
            throw new Error(`maxDocuments must be between 1 and ${MAX_INDEXED_DOCUMENTS}`);
        this.maxDocuments = maxDocuments;
    }
    upsert(note) {
        this.unindex(note.path);
        const content = `${note.path}\n${note.content || ''}\n${note.frontmatter ? JSON.stringify(note.frontmatter) : ''}`;
        const document = {
            note: { ...note, ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }) },
            title: normalize(note.path.split('/').pop()?.replace(/\.(?:md|markdown|txt)$/i, '') || note.path),
            tokenCounts: tokenCounts(content),
        };
        this.documents.set(note.path, document);
        for (const [token, count] of document.tokenCounts) {
            const posting = this.postings.get(token) || new Map();
            posting.set(note.path, count);
            this.postings.set(token, posting);
        }
        this.searchCache.clear();
        while (this.documents.size > this.maxDocuments) {
            const oldestPath = this.documents.keys().next().value;
            this.unindex(oldestPath);
            this.documents.delete(oldestPath);
        }
    }
    remove(path) {
        this.unindex(path);
        this.documents.delete(path);
        this.searchCache.clear();
    }
    clear() {
        this.documents.clear();
        this.postings.clear();
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
        const candidatePaths = new Set();
        for (const term of queryTerms) {
            for (const path of this.postings.get(term)?.keys() || [])
                candidatePaths.add(path);
        }
        const ranked = [];
        for (const path of candidatePaths) {
            const document = this.documents.get(path);
            if (!document)
                continue;
            const searchable = normalize(`${document.note.path}\n${document.note.content || ''}\n${document.note.frontmatter ? JSON.stringify(document.note.frontmatter) : ''}`);
            let score = 0;
            for (const term of queryTerms) {
                const count = document.tokenCounts.get(term) || 0;
                score += count;
                if (document.title.includes(term))
                    score += 5;
            }
            if (searchable.includes(normalize(normalizedQuery)))
                score += 4;
            if (score === 0)
                continue;
            ranked.push({ path: document.note.path, score, excerpt: excerpt(document.note.content || searchable, normalizedQuery, maxChars), revision: document.note.revision });
        }
        ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
        const result = { complete: false, indexedDocuments: this.documents.size, results: ranked.slice(0, limit) };
        this.searchCache.set(cacheKey, cloneSearchResponse(result));
        while (this.searchCache.size > 128)
            this.searchCache.delete(this.searchCache.keys().next().value);
        return result;
    }
    unindex(path) {
        const document = this.documents.get(path);
        if (!document)
            return;
        for (const token of document.tokenCounts.keys()) {
            const posting = this.postings.get(token);
            posting?.delete(path);
            if (posting && posting.size === 0)
                this.postings.delete(token);
        }
    }
}
function cloneSearchResponse(value) {
    return { ...value, results: value.results.map(result => ({ ...result })) };
}
