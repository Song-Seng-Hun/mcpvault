import type { CachedNote, ClientKeyValueStore } from './client-cache.js';

export interface ClientSearchResult {
  path: string;
  score: number;
  excerpt: string;
  revision: string;
}

export interface ClientSearchResponse {
  /** False because the client index contains only documents explicitly cached by the host. */
  complete: false;
  indexedDocuments: number;
  results: ClientSearchResult[];
}

interface IndexedDocument {
  note: CachedNote;
  title: string;
  tokenCounts: Map<string, number>;
}

const MAX_QUERY_CHARS = 500;
const MAX_RESULT_LIMIT = 50;
const MAX_INDEXED_DOCUMENTS = 5_000;
const MAX_TOKENS_PER_DOCUMENT = 4_096;

type SearchCacheEntry = ClientSearchResponse;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function terms(value: string): string[] {
  const normalized = normalize(value).trim();
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];
  const grams: string[] = [];
  for (const word of words) {
    if (word.length < 2) continue;
    for (let index = 0; index < word.length - 1; index += 1) grams.push(word.slice(index, index + 2));
  }
  return [...new Set([...words, ...grams])];
}

function tokenCounts(value: string): Map<string, number> {
  const normalized = normalize(value);
  const counts = new Map<string, number>();
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];
  const add = (token: string): boolean => {
    if (!counts.has(token) && counts.size >= MAX_TOKENS_PER_DOCUMENT) return false;
    counts.set(token, (counts.get(token) || 0) + 1);
    return true;
  };
  for (const word of words) {
    if (!add(word)) break;
    if (word.length < 2) continue;
    for (let index = 0; index < word.length - 1 && counts.size < MAX_TOKENS_PER_DOCUMENT; index += 1) {
      const gram = word.slice(index, index + 2);
      add(gram);
    }
  }
  return counts;
}

function excerpt(text: string, query: string, maxChars: number): string {
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
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly searchCache = new Map<string, SearchCacheEntry>();
  private readonly maxDocuments: number;

  constructor(options: { maxDocuments?: number } = {}) {
    const maxDocuments = options.maxDocuments ?? MAX_INDEXED_DOCUMENTS;
    if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > MAX_INDEXED_DOCUMENTS) throw new Error(`maxDocuments must be between 1 and ${MAX_INDEXED_DOCUMENTS}`);
    this.maxDocuments = maxDocuments;
  }

  upsert(note: CachedNote): void {
    this.unindex(note.path);
    const content = `${note.path}\n${note.content || ''}\n${note.frontmatter ? JSON.stringify(note.frontmatter) : ''}`;
    const document: IndexedDocument = {
      note: { ...note, ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }) },
      title: normalize(note.path.split('/').pop()?.replace(/\.(?:md|markdown|txt)$/i, '') || note.path),
      tokenCounts: tokenCounts(content),
    };
    this.documents.set(note.path, document);
    for (const [token, count] of document.tokenCounts) {
      const posting = this.postings.get(token) || new Map<string, number>();
      posting.set(note.path, count);
      this.postings.set(token, posting);
    }
    this.searchCache.clear();
    while (this.documents.size > this.maxDocuments) {
      const oldestPath = this.documents.keys().next().value!;
      this.unindex(oldestPath);
      this.documents.delete(oldestPath);
    }
  }

  remove(path: string): void {
    this.unindex(path);
    this.documents.delete(path);
    this.searchCache.clear();
  }

  clear(): void {
    this.documents.clear();
    this.postings.clear();
    this.searchCache.clear();
  }

  size(): number {
    return this.documents.size;
  }

  values(): CachedNote[] {
    return [...this.documents.values()].map(document => ({
      ...document.note,
      ...(document.note.frontmatter && { frontmatter: { ...document.note.frontmatter } }),
    }));
  }

  snapshot(): string {
    return JSON.stringify(this.values());
  }

  restore(snapshot: string): number {
    let parsed: unknown;
    try { parsed = JSON.parse(snapshot); } catch { return 0; }
    if (!Array.isArray(parsed)) return 0;
    let restored = 0;
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const note = value as Partial<CachedNote>;
      if (typeof note.path !== 'string' || !note.path || typeof note.revision !== 'string' || !note.revision) continue;
      this.upsert({
        path: note.path,
        revision: note.revision,
        ...(typeof note.content === 'string' && { content: note.content }),
        ...(note.frontmatter && typeof note.frontmatter === 'object' && { frontmatter: note.frontmatter as Record<string, unknown> }),
        ...(typeof note.obsidianUri === 'string' && { obsidianUri: note.obsidianUri }),
      });
      restored += 1;
    }
    return restored;
  }

  persist(store: ClientKeyValueStore, key: string): void {
    store.setItem(key, this.snapshot());
  }

  hydrate(store: ClientKeyValueStore, key: string): number {
    const snapshot = store.getItem(key);
    return snapshot ? this.restore(snapshot) : 0;
  }

  search(query: string, options: { limit?: number; maxChars?: number } = {}): ClientSearchResponse {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) throw new Error('query is required');
    if (normalizedQuery.length > MAX_QUERY_CHARS) throw new Error(`query cannot exceed ${MAX_QUERY_CHARS} characters`);
    const cacheKey = JSON.stringify({ query: normalizedQuery, limit: options.limit, maxChars: options.maxChars });
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cloneSearchResponse(cached);
    const queryTerms = terms(normalizedQuery);
    if (queryTerms.length === 0) return { complete: false, indexedDocuments: this.documents.size, results: [] };
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 5), 1), MAX_RESULT_LIMIT);
    const maxChars = Math.min(Math.max(Math.floor(options.maxChars ?? 240), 80), 2000);
    const candidatePaths = new Set<string>();
    for (const term of queryTerms) {
      for (const path of this.postings.get(term)?.keys() || []) candidatePaths.add(path);
    }
    const ranked: ClientSearchResult[] = [];
    for (const path of candidatePaths) {
      const document = this.documents.get(path);
      if (!document) continue;
      const searchable = normalize(`${document.note.path}\n${document.note.content || ''}\n${document.note.frontmatter ? JSON.stringify(document.note.frontmatter) : ''}`);
      let score = 0;
      for (const term of queryTerms) {
        const count = document.tokenCounts.get(term) || 0;
        score += count;
        if (document.title.includes(term)) score += 5;
      }
      if (searchable.includes(normalize(normalizedQuery))) score += 4;
      if (score === 0) continue;
      ranked.push({ path: document.note.path, score, excerpt: excerpt(document.note.content || searchable, normalizedQuery, maxChars), revision: document.note.revision });
    }
    ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    const result = { complete: false as const, indexedDocuments: this.documents.size, results: ranked.slice(0, limit) };
    this.searchCache.set(cacheKey, cloneSearchResponse(result));
    while (this.searchCache.size > 128) this.searchCache.delete(this.searchCache.keys().next().value!);
    return result;
  }

  private unindex(path: string): void {
    const document = this.documents.get(path);
    if (!document) return;
    for (const token of document.tokenCounts.keys()) {
      const posting = this.postings.get(token);
      posting?.delete(path);
      if (posting && posting.size === 0) this.postings.delete(token);
    }
  }
}

function cloneSearchResponse(value: ClientSearchResponse): ClientSearchResponse {
  return { ...value, results: value.results.map(result => ({ ...result })) };
}
