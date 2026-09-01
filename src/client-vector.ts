import type { AsyncClientKeyValueStore, ClientKeyValueStore } from './client-cache.js';

export interface ClientVectorSearchResult {
  path: string;
  score: number;
  revision: string;
}

export interface ClientVectorSearchResponse {
  /** False because this index contains only vectors explicitly supplied by the host. */
  complete: false;
  indexedDocuments: number;
  dimension: number;
  results: ClientVectorSearchResult[];
}

export interface ClientVectorIndexOptions {
  maxDocuments?: number;
  dimension?: number;
}

interface VectorEntry {
  path: string;
  revision: string;
  vector: Float32Array;
}

interface VectorSnapshot {
  version: 1;
  dimension: number;
  entries: Array<{ path: string; revision: string; vector: number[] }>;
}

const MAX_DOCUMENTS = 5_000;
const MAX_RESULT_LIMIT = 50;

/**
 * Lightweight host-side vector ranking. The host owns embedding generation;
 * this class only stores bounded normalized vectors and ranks explicitly
 * supplied candidates. Callers must confirm results with authoritative server
 * search/read and scope checks before using them as current data.
 */
export class McpVaultClientVectorIndex {
  private readonly entries = new Map<string, VectorEntry>();
  private readonly maxDocuments: number;
  private readonly configuredDimension: number | undefined;
  private dimension = 0;

  constructor(options: ClientVectorIndexOptions = {}) {
    const maxDocuments = options.maxDocuments ?? MAX_DOCUMENTS;
    if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > MAX_DOCUMENTS) throw new Error(`maxDocuments must be between 1 and ${MAX_DOCUMENTS}`);
    if (options.dimension !== undefined && (!Number.isInteger(options.dimension) || options.dimension < 1)) throw new Error('dimension must be a positive integer');
    this.maxDocuments = maxDocuments;
    this.configuredDimension = options.dimension;
    this.dimension = options.dimension || 0;
  }

  upsert(path: string, revision: string, vector: ArrayLike<number>): void {
    const normalizedPath = String(path || '').trim();
    const normalizedRevision = String(revision || '').trim();
    if (!normalizedPath) throw new Error('path is required');
    if (!normalizedRevision) throw new Error('revision is required');
    const normalizedVector = normalizeVector(vector);
    this.assertDimension(normalizedVector.length);
    this.entries.delete(normalizedPath);
    this.entries.set(normalizedPath, { path: normalizedPath, revision: normalizedRevision, vector: normalizedVector });
    while (this.entries.size > this.maxDocuments) this.entries.delete(this.entries.keys().next().value!);
  }

  remove(path: string): boolean {
    return this.entries.delete(String(path || '').trim());
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  search(queryVector: ArrayLike<number>, options: { limit?: number; minScore?: number } = {}): ClientVectorSearchResponse {
    const query = normalizeVector(queryVector);
    this.assertDimension(query.length);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 5), 1), MAX_RESULT_LIMIT);
    const minScore = options.minScore ?? -1;
    if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) throw new Error('minScore must be between -1 and 1');
    const ranked: ClientVectorSearchResult[] = [];
    for (const entry of this.entries.values()) {
      const score = dot(query, entry.vector);
      if (score < minScore) continue;
      pushTopResult(ranked, { path: entry.path, score, revision: entry.revision }, limit);
    }
    ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return { complete: false, indexedDocuments: this.entries.size, dimension: this.dimension, results: ranked };
  }

  snapshot(): string {
    return JSON.stringify({
      version: 1,
      dimension: this.dimension,
      entries: [...this.entries.values()].map(entry => ({ path: entry.path, revision: entry.revision, vector: [...entry.vector] })),
    } satisfies VectorSnapshot);
  }

  restore(snapshot: string): number {
    let parsed: unknown;
    try { parsed = JSON.parse(snapshot); } catch { return 0; }
    if (!parsed || typeof parsed !== 'object') return 0;
    const value = parsed as Partial<VectorSnapshot>;
    if (value.version !== 1 || !Array.isArray(value.entries)) return 0;
    if (value.dimension !== undefined && (!Number.isInteger(value.dimension) || value.dimension < 1)) return 0;
    let restored = 0;
    for (const entry of value.entries) {
      if (!entry || typeof entry !== 'object' || !Array.isArray(entry.vector)) continue;
      try {
        this.upsert(entry.path, entry.revision, entry.vector);
        restored += 1;
      } catch {
        // Ignore one corrupt vector and keep the remaining index usable.
      }
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

  async persistAsync(store: AsyncClientKeyValueStore, key: string): Promise<void> {
    await store.setItem(key, this.snapshot());
  }

  async hydrateAsync(store: AsyncClientKeyValueStore, key: string): Promise<number> {
    const snapshot = await store.getItem(key);
    return snapshot ? this.restore(snapshot) : 0;
  }

  private assertDimension(dimension: number): void {
    if (this.configuredDimension !== undefined && dimension !== this.configuredDimension) throw new Error(`vector dimension must be ${this.configuredDimension}`);
    if (this.dimension === 0) this.dimension = dimension;
    if (dimension !== this.dimension) throw new Error(`vector dimension must be ${this.dimension}`);
  }
}

function normalizeVector(vector: ArrayLike<number>): Float32Array {
  const values = Array.from(vector, value => Number(value));
  if (values.length < 1) throw new Error('vector must not be empty');
  let magnitude = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('vector values must be finite numbers');
    magnitude += value * value;
  }
  if (magnitude === 0) throw new Error('vector must not be zero');
  const scale = 1 / Math.sqrt(magnitude);
  return Float32Array.from(values, value => value * scale);
}

function dot(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index]! * right[index]!;
  return score;
}

function compareResults(left: ClientVectorSearchResult, right: ClientVectorSearchResult): number {
  return left.score - right.score || right.path.localeCompare(left.path);
}

function pushTopResult(heap: ClientVectorSearchResult[], result: ClientVectorSearchResult, limit: number): void {
  if (heap.length < limit) {
    heap.push(result);
    siftUp(heap, heap.length - 1);
    return;
  }
  if (compareResults(result, heap[0]!) <= 0) return;
  heap[0] = result;
  siftDown(heap, 0);
}

function siftUp(heap: ClientVectorSearchResult[], index: number): void {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareResults(heap[index]!, heap[parent]!) >= 0) break;
    [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
    index = parent;
  }
}

function siftDown(heap: ClientVectorSearchResult[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && compareResults(heap[left]!, heap[worst]!) < 0) worst = left;
    if (right < heap.length && compareResults(heap[right]!, heap[worst]!) < 0) worst = right;
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst]!, heap[index]!];
    index = worst;
  }
}
