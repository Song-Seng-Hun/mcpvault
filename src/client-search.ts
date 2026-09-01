import type { CachedNote } from './client-cache.js';

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
  searchable: string;
  title: string;
}

const MAX_QUERY_CHARS = 500;
const MAX_RESULT_LIMIT = 50;

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

  upsert(note: CachedNote): void {
    const content = `${note.path}\n${note.content || ''}\n${note.frontmatter ? JSON.stringify(note.frontmatter) : ''}`;
    this.documents.set(note.path, {
      note: { ...note, ...(note.frontmatter && { frontmatter: { ...note.frontmatter } }) },
      searchable: normalize(content),
      title: normalize(note.path.split('/').pop()?.replace(/\.(?:md|markdown|txt)$/i, '') || note.path),
    });
  }

  remove(path: string): void {
    this.documents.delete(path);
  }

  clear(): void {
    this.documents.clear();
  }

  size(): number {
    return this.documents.size;
  }

  search(query: string, options: { limit?: number; maxChars?: number } = {}): ClientSearchResponse {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) throw new Error('query is required');
    if (normalizedQuery.length > MAX_QUERY_CHARS) throw new Error(`query cannot exceed ${MAX_QUERY_CHARS} characters`);
    const queryTerms = terms(normalizedQuery);
    if (queryTerms.length === 0) return { complete: false, indexedDocuments: this.documents.size, results: [] };
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 5), 1), MAX_RESULT_LIMIT);
    const maxChars = Math.min(Math.max(Math.floor(options.maxChars ?? 240), 80), 2000);
    const ranked: ClientSearchResult[] = [];
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
        if (document.title.includes(term)) score += 5;
      }
      if (document.searchable.includes(normalize(normalizedQuery))) score += 4;
      if (score === 0) continue;
      ranked.push({ path: document.note.path, score, excerpt: excerpt(document.note.content || document.searchable, normalizedQuery, maxChars), revision: document.note.revision });
    }
    ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return { complete: false, indexedDocuments: this.documents.size, results: ranked.slice(0, limit) };
  }
}
