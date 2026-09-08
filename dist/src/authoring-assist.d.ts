export declare function propertyContractFingerprint(): string;
export interface AuthoringContext {
    intent?: 'knowledge' | 'capture' | 'reply' | 'new_topic';
    slug?: string;
    provided?: Record<string, unknown>;
}
export declare function authoringAssist(noteKind: string, context?: AuthoringContext): {
    contractFingerprint: string;
    defaults: Record<string, unknown>;
    fields: import("./organization.js").OrganizationPropertyContractEntry[];
    missing: string[];
    nextAction: {
        endpointId: string;
        arguments: {
            slug?: string;
        };
        instruction: string;
    };
    normalization: {
        mechanical: string[];
        semantic: string[];
        instruction: "Do not refresh evidence or summary fingerprints merely to remove lint warnings. Review exact notes.change_set dry-run before applying formatting.";
    };
};
export declare function hostPluginBundle(): {
    fingerprint: string;
    templates: {
        path: string;
        content: string;
    }[];
    fileClassesPath: string;
    fileClasses: {
        path: string;
        content: string;
    }[];
};
//# sourceMappingURL=authoring-assist.d.ts.map