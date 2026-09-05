/** Streams admitted, masked rows only; storage scales with sources, not edges. */
export declare class NavigationViewFingerprint {
    private readonly identity;
    private readonly sources;
    constructor(identity: readonly string[]);
    add(path: string, revision: string, row: unknown): void;
    finish(): string;
}
//# sourceMappingURL=navigation-view.d.ts.map