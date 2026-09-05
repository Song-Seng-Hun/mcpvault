/** Exact SCC classification with explicit DFS frames, independent of the JS
 * call-stack depth. Preserve the original caller/input-rank ordering. */
export declare function classifyDependencyResidual(nodes: string[], adjacency: Map<string, Set<string>>): {
    cycles: string[][];
    cycleNodes: Set<string>;
    blocked: string[];
};
//# sourceMappingURL=dependency-graph.d.ts.map