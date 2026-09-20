import type { QueryNote } from '../types.js';
import { type GraphAssertion } from '../graph-assertion.js';
export interface MemoryIndexRow extends QueryNote {
    text: string;
}
export interface MemoryIndexPage {
    notes: QueryNote[];
    truncated: boolean;
    generation: number;
}
export interface MemoryIndexQuery {
    prefix?: string;
    terms: string[];
    role?: string;
    dateFrom?: string;
    dateTo?: string;
    after?: string;
    limit: number;
}
export interface GraphIndexQuery {
    direction: 'incoming' | 'outgoing';
    keys: string[];
    limit: number;
    after?: string;
    expectedGeneration?: number;
}
export interface GraphIndexPage {
    occurrences: GraphAssertion[];
    truncated: boolean;
    next?: string;
    generation: number;
    incompleteOwners: string[];
    coverage: 'candidates_only';
}
export interface ReferenceImpactQuery {
    keys: string[];
    limit: number;
    expectedGeneration?: number;
}
export interface ReferenceImpactPage {
    candidates: Array<{
        path: string;
        revision: string;
    }>;
    truncated: boolean;
    complete: boolean;
    generation: number;
}
/** One bounded RPC queue. SQLite and its native allocations stay off the request thread. */
export declare class MemorySqliteStore {
    private worker;
    private serial;
    private closed;
    private pending;
    constructor(path: string);
    private call;
    ready(): Promise<void>;
    generation(): Promise<number>;
    put(rows: MemoryIndexRow[]): Promise<void>;
    remove(paths: string[]): Promise<void>;
    page(q: MemoryIndexQuery): Promise<MemoryIndexPage>;
    dependents(paths: string[], limit: number): Promise<MemoryIndexPage>;
    get(paths: string[]): Promise<MemoryIndexPage>;
    explain(q: MemoryIndexQuery): Promise<string[]>;
    private graphQuery;
    /** PRIVATE unresolved occurrences. Callers must re-resolve and authorize both endpoints.
     * An empty page never certifies absence of links in the Vault. */
    graph(q: GraphIndexQuery): Promise<GraphIndexPage>;
    graphExplain(q: GraphIndexQuery): Promise<string[]>;
    private referenceQuery;
    /** Private discovery only. Recheck live identities, ACL and generation before resolving. */
    referenceCandidates(keys: string[], limit: number): Promise<MemoryIndexPage>;
    referenceExplain(keys: string[], limit: number): Promise<string[]>;
    /** Private integrity postings, including non-navigational checkpoint paths.
     * No memory/search visibility is granted by adding a row here. */
    putReferenceDocuments(rows: MemoryIndexRow[]): Promise<void>;
    removeReferenceDocuments(paths: string[]): Promise<void>;
    private impactQuery;
    referenceImpact(q: ReferenceImpactQuery): Promise<ReferenceImpactPage>;
    referenceImpactExplain(q: ReferenceImpactQuery): Promise<string[]>;
    beginReferenceScan(): Promise<void>;
    seenReferences(paths: string[]): Promise<void>;
    finishReferenceScan(): Promise<void>;
    unindexedGraph(paths: string[]): Promise<string[]>;
    beginScan(): Promise<void>;
    seen(paths: string[]): Promise<void>;
    finishScan(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=sqlite-store.d.ts.map