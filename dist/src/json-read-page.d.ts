export type JsonReadPage = {
    path: string;
    revision: string;
    kind: string;
    value?: unknown;
    entries?: Array<Record<string, unknown>>;
};
export declare const jsonWireBytes: (value: unknown) => number;
export declare function jsonPointerNode(root: unknown, path: string): unknown;
/** Page a freshly authorized JSON value; no content cache or execution authority. */
export declare function pageJsonRead(node: unknown, path: string, basis: unknown, cursor: unknown, budget: number, envelope: (page: JsonReadPage, total: number, truncated: boolean, nextCursor?: string) => Record<string, unknown>, childReference?: (path: string) => Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=json-read-page.d.ts.map