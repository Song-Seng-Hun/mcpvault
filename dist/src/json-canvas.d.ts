export type WikiCanvasMode = 'moc' | 'neighborhood';
export interface WikiCanvasNote {
    path: string;
    publicPath: string;
    revision: string;
    title: string;
    role: 'root' | 'moc_entry' | 'neighbor';
    depth?: number;
    authoredPosition?: number;
    stage?: number | undefined;
    reasons?: string[];
}
export interface WikiCanvasEdge {
    fromPath: string;
    toPath: string;
    label: string;
    kind: 'authored' | 'dependency' | 'direct_link' | 'backlink' | 'proximity';
}
export type JsonCanvasNode = {
    id: string;
    type: 'file' | 'text';
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string | undefined;
    file?: string;
    text?: string;
};
export type JsonCanvasEdge = {
    id: string;
    fromNode: string;
    fromSide?: 'top' | 'right' | 'bottom' | 'left';
    fromEnd?: 'none' | 'arrow';
    toNode: string;
    toSide?: 'top' | 'right' | 'bottom' | 'left';
    toEnd?: 'none' | 'arrow';
    color?: string;
    label?: string;
};
export interface JsonCanvasDocument {
    nodes: JsonCanvasNode[];
    edges: JsonCanvasEdge[];
}
/**
 * Build a deterministic JSON Canvas projection. Positions and IDs derive only
 * from the selected paths/order so exporting an unchanged snapshot does not
 * manufacture a noisy file revision.
 */
export declare function buildJsonCanvasProjection(input: {
    mode: WikiCanvasMode;
    notes: WikiCanvasNote[];
    edges: WikiCanvasEdge[];
}): {
    canvas: JsonCanvasDocument;
    snapshotFingerprint: string;
};
/** Validate the bounded subset of JSON Canvas 1.0 that MCPVault emits. */
export declare function validateJsonCanvasDocument(value: unknown): asserts value is JsonCanvasDocument;
//# sourceMappingURL=json-canvas.d.ts.map