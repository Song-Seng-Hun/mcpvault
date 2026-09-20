import type { QueryNote } from '../types.js';
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
    beginScan(): Promise<void>;
    seen(paths: string[]): Promise<void>;
    finishScan(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=sqlite-store.d.ts.map