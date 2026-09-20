import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QueryNote } from '../types.js';
import { memoryEntries, memoryReferencePath } from '../memory-contract.js';
import { extractGraphAssertions, type GraphAssertion } from '../graph-assertion.js';
import { extractObsidianLinkOccurrences } from '../backlinks.js';
import { buildNoteReferenceIndex, markdownNotePath } from '../note-reference.js';
import { referenceDocumentPath, referenceFootprint } from '../curation/reference-footprint.js';

export interface MemoryIndexRow extends QueryNote { text: string }
export interface MemoryIndexPage { notes: QueryNote[]; truncated: boolean; generation: number }
export interface MemoryIndexQuery { prefix?: string; terms: string[]; role?: string; dateFrom?: string; dateTo?: string; after?: string; limit: number }
export interface GraphIndexQuery { direction: 'incoming' | 'outgoing'; keys: string[]; limit: number; after?: string; expectedGeneration?: number }
export interface GraphIndexPage { occurrences: GraphAssertion[]; truncated: boolean; next?: string;
  generation: number; incompleteOwners: string[]; coverage: 'candidates_only' }
export interface ReferenceImpactQuery { keys: string[]; limit: number; expectedGeneration?: number }
export interface ReferenceImpactPage { candidates: Array<{ path: string; revision: string }>; truncated: boolean;
  complete: boolean; generation: number }

// Discovery key only, never a resolved path or permission. Preserve raw reference in payload.
function referenceKey(raw: string): string {
  return raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split(/[|#]/, 1)[0]!.trim().replace(/\.md$/i, '').toLowerCase();
}
function occurrenceKey(assertion: GraphAssertion): string {
  if (assertion.syntax !== 'markdown') return referenceKey(assertion.targetReference);
  const link = extractObsidianLinkOccurrences(assertion.targetReference, 1)[0];
  // Preserve the original occurrence as evidence. Only its advisory index key
  // resolves explicit Markdown relativity; aliases still require live resolution.
  return link ? referenceKey(markdownNotePath(link.target, assertion.source.path) ?? '')
    : referenceKey(assertion.targetReference);
}

/** One bounded RPC queue. SQLite and its native allocations stay off the request thread. */
export class MemorySqliteStore {
  private worker: Worker;
  private serial = 0;
  private closed = false;
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer: NodeJS.Timeout }>();
  constructor(path: string) {
    const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number);
    if (major < 22 || major === 22 && (minor < 23 || minor === 23 && patch < 2)) throw Error('Disk memory requires Node 22.23.2 or newer');
    const js = new URL('./sqlite-worker.js', import.meta.url);
    const url = existsSync(fileURLToPath(js)) ? js : new URL('./sqlite-worker.ts', import.meta.url);
    this.worker = new Worker(url, { workerData: { path }, execArgv: url.pathname.endsWith('.ts') ? ['--experimental-strip-types'] : [], resourceLimits: { maxOldGenerationSizeMb: 128 } });
    this.worker.on('message', ({ id, value, error }) => { const p = this.pending.get(id); if (!p) return; this.pending.delete(id); clearTimeout(p.timer); error ? p.reject(Error('Memory read index unavailable')) : p.resolve(value); });
    const fail = () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Memory read index unavailable')); } this.pending.clear(); };
    this.worker.on('error', fail); this.worker.on('exit', fail);
  }
  private call<T>(op: string, data: unknown = {}): Promise<T> {
    if (this.closed || this.pending.size >= 8) return Promise.reject(Error('Memory index busy or closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.serial, timer = setTimeout(() => { this.pending.delete(id); reject(Error('Memory index timed out')); void this.worker.terminate(); }, 30000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, op, data });
    });
  }
  ready() { return this.call<void>('ready'); }
  generation() { return this.call<number>('generation'); }
  async put(rows: MemoryIndexRow[]) {
    if (rows.length > 128) throw Error('Memory index batch exceeds limit');
    const data = rows.map(row => {
      memoryReferencePath(row.path);
      if (!/^[a-f0-9]{64}$/.test(row.revision || '') || typeof row.text !== 'string' || row.text.length > 2_000_000 || JSON.stringify(row.frontmatter).length > 128000) throw Error('Invalid memory index row');
      const entries = memoryEntries(row.frontmatter);
      if (!entries.length && row.frontmatter.mcpvault_type === 'journal_entry') entries.push({ role: 'episodic', observed_at: row.frontmatter.date });
      const graph = extractGraphAssertions({ repositoryId: 'private-read-index', path: row.path, revision: row.revision!, frontmatter: row.frontmatter, content: row.text });
      const identities = buildNoteReferenceIndex([{ path: row.path, title: row.frontmatter.title,
        aliases: row.frontmatter.aliases, preferredTerm: row.frontmatter.preferred_term, stableId: row.frontmatter.stable_id }]);
      const names = [...new Set([identities.qualified, identities.exact, identities.filenames, identities.terms].flatMap(m => [...m.keys()]))];
      if (names.length > 512) throw Error('Graph identity budget exceeded');
      return { ...row, entries, names, graph: { version: 2, partial: graph.partial, occurrences: graph.assertions.map(a => ({ key: occurrenceKey(a), assertion: a })) },
        edges: entries.flatMap(e => (['basis', 'corrects'] as const).flatMap(kind => (e[kind] || []).map(r => ({ kind, target: memoryReferencePath(r.path).toLowerCase() })))) };
    });
    await this.call('put', data);
  }
  remove(paths: string[]) { paths.forEach(memoryReferencePath); if (paths.length > 128) throw Error('Memory index batch exceeds limit'); return this.call<void>('remove', paths); }
  async page(q: MemoryIndexQuery) {
    if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 500 || q.terms.length > 32 || q.terms.some(t => typeof t !== 'string' || t.length > 1000)) throw Error('Invalid memory index query');
    return this.call<MemoryIndexPage>('page', q);
  }
  dependents(paths: string[], limit: number) {
    paths.forEach(memoryReferencePath); if (paths.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 201) throw Error('Invalid dependency window');
    return this.call<MemoryIndexPage>('dependents', { paths: paths.map(p => p.toLowerCase()), limit });
  }
  get(paths: string[]) { paths.forEach(memoryReferencePath); if (paths.length > 500) throw Error('Invalid metadata window'); return this.call<MemoryIndexPage>('get', paths); }
  explain(q: MemoryIndexQuery) { return this.call<string[]>('explain', q); }
  private graphQuery(q: GraphIndexQuery) {
    if (!['incoming', 'outgoing'].includes(q.direction) || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > 200
      || !Array.isArray(q.keys) || !q.keys.length || q.keys.length > 200
      || q.keys.some(k => typeof k !== 'string' || !k.length || k.length > 1024)
      || q.after !== undefined && (!/^[a-f0-9]{64}$/.test(q.after) || q.expectedGeneration === undefined)
      || q.expectedGeneration !== undefined && (!Number.isSafeInteger(q.expectedGeneration) || q.expectedGeneration < 0)) throw Error('Invalid graph window');
    if (q.direction === 'outgoing') q.keys.forEach(memoryReferencePath);
    return { ...q, keys: [...new Set(q.direction === 'incoming' ? q.keys.map(referenceKey) : q.keys)] };
  }
  /** PRIVATE unresolved occurrences. Callers must re-resolve and authorize both endpoints.
   * An empty page never certifies absence of links in the Vault. */
  async graph(q: GraphIndexQuery) { return this.call<GraphIndexPage>('graph', this.graphQuery(q)); }
  async graphExplain(q: GraphIndexQuery) { return this.call<string[]>('graphExplain', this.graphQuery(q)); }
  private referenceQuery(keys: string[], limit: number) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 8 || keys.some(k => typeof k !== 'string' || !k.trim() || k.length > 1024)
      || !Number.isInteger(limit) || limit < 1 || limit > 64) throw Error('Invalid reference window');
    return { keys: [...new Set(keys.map(k => k.trim().toLocaleLowerCase()))], limit };
  }
  /** Private discovery only. Recheck live identities, ACL and generation before resolving. */
  referenceCandidates(keys: string[], limit: number) { return this.call<MemoryIndexPage>('references', this.referenceQuery(keys, limit)); }
  referenceExplain(keys: string[], limit: number) { return this.call<string[]>('referencesExplain', this.referenceQuery(keys, limit)); }
  /** Private integrity postings, including non-navigational checkpoint paths.
   * No memory/search visibility is granted by adding a row here. */
  async putReferenceDocuments(rows: MemoryIndexRow[]) {
    if (rows.length > 128) throw Error('Reference batch exceeds limit');
    const data = rows.map(row => {
      referenceDocumentPath(row.path);
      if (!/^[a-f0-9]{64}$/.test(row.revision || '') || typeof row.text !== 'string' || row.text.length > 2_000_000
        || JSON.stringify(row.frontmatter).length > 128000) throw Error('Invalid reference row');
      return { path: row.path, revision: row.revision, ...referenceFootprint(row), version: 1 };
    });
    return this.call<void>('putReferences', data);
  }
  removeReferenceDocuments(paths: string[]) {
    paths.forEach(referenceDocumentPath); if (paths.length > 128) throw Error('Reference batch exceeds limit');
    return this.call<void>('removeReferences', paths);
  }
  private impactQuery(q: ReferenceImpactQuery) {
    if (!Array.isArray(q.keys) || !q.keys.length || q.keys.length > 128 || q.keys.some(k => typeof k !== 'string' || !k || k.length > 1024)
      || !Number.isInteger(q.limit) || q.limit < 1 || q.limit > 200
      || q.expectedGeneration !== undefined && (!Number.isSafeInteger(q.expectedGeneration) || q.expectedGeneration < 0)) throw Error('Invalid reference impact window');
    return { ...q, keys: [...new Set(q.keys)] };
  }
  referenceImpact(q: ReferenceImpactQuery) { return this.call<ReferenceImpactPage>('referenceImpact', this.impactQuery(q)); }
  referenceImpactExplain(q: ReferenceImpactQuery) { return this.call<string[]>('referenceImpactExplain', this.impactQuery(q)); }
  beginReferenceScan() { return this.call<void>('beginReferenceScan'); }
  seenReferences(paths: string[]) {
    paths.forEach(referenceDocumentPath); if (paths.length > 128) throw Error('Invalid reference scan page');
    return this.call<void>('seenReferences', paths);
  }
  finishReferenceScan() { return this.call<void>('finishReferenceScan'); }
  unindexedGraph(paths: string[]) {
    paths.forEach(memoryReferencePath); if (paths.length > 128) throw Error('Invalid graph backfill window');
    return this.call<string[]>('unindexedGraph', paths);
  }
  beginScan() { return this.call<void>('beginScan'); }
  seen(paths: string[]) { if (paths.length > 128) throw Error('Invalid scan page'); return this.call<void>('seen', paths); }
  finishScan() { return this.call<void>('finishScan'); }
  async close() { if (this.closed) return; try { await this.call('close'); } finally { this.closed = true; await this.worker.terminate(); } }
}
