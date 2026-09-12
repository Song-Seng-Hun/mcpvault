/** Comparator order is best first; storage is bounded independently of input size. */
export declare class DocumentTopK<T> {
    readonly capacity: number;
    private readonly compare;
    private readonly rows;
    constructor(capacity: number, compare: (a: T, b: T) => number);
    get size(): number;
    offer(row: T): void;
    sorted(): T[];
}
//# sourceMappingURL=document-ranking.d.ts.map