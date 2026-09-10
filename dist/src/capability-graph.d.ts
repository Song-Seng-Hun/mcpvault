export interface CapabilityNode {
    id: string;
    requires: string[];
    excludes: string[];
    cost: number;
}
export declare function configId(value: unknown): string;
export declare function configKeys(value: any, allowed: string[]): void;
export declare function configNumber(value: unknown, min?: number, max?: number): number;
export declare function configIds(value: unknown, max?: number): string[];
export declare function validateCapabilityGraph(input: unknown): CapabilityNode[];
export declare function validateCapabilitySelection(nodes: CapabilityNode[], input: unknown): string[];
export declare function capabilityRemoval(nodes: CapabilityNode[], learned: string[], requested: unknown): string[];
export interface CapabilityConfigurationCheck {
    kind: 'learning-path' | 'procedural-bundle';
    id: string;
    version: string;
    valid: true;
    nodeCount: number;
    selectedCount: number;
    totalCost: number;
    fingerprint: string;
    executable: false;
    permissionsGranted: false;
}
export declare function validateLearningPathConfiguration(input: unknown): CapabilityConfigurationCheck;
export declare function validateProceduralBundleConfiguration(input: unknown): CapabilityConfigurationCheck;
//# sourceMappingURL=capability-graph.d.ts.map