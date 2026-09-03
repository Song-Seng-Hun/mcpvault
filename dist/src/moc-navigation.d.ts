/** Derived MOC navigation. Callers must supply only visible, non-hidden notes. */
export interface MocNode {
    path: string;
    title?: unknown;
    navOrder?: unknown;
    parent?: string | undefined;
}
export declare function navigationOrder(value: unknown): number;
export declare function compareMocNavigation(left: MocNode, right: MocNode): number;
/** Iterative preorder traversal keeps each branch together, even in deep vaults. */
export declare function buildMocNavigation<T extends MocNode>(nodes: T[]): {
    items: (T & {
        resolvedParent?: string;
        children: string[];
        childTotal: number;
        depth: number;
        state: string;
    })[];
    roots: string[];
    missingParents: {
        path: string;
        parent: string;
        reason: string;
    }[];
    ambiguousParents: {
        path: string;
        parent: string;
        matches: string[];
        reason: string;
    }[];
    cycles: {
        nodes: string[];
        reason: string;
    }[];
    explicitParentEdges: number;
    maxDepth: number;
};
//# sourceMappingURL=moc-navigation.d.ts.map