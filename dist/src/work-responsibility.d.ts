export interface WorkResource {
    path?: string;
    repository?: string;
    file?: string;
}
export interface WorkResponsibility {
    question?: string;
    perspective?: string;
    mode?: 'exclusive_write' | 'advice' | 'alternative';
    deliverables?: string[];
    conditions?: string[];
    coversCriteria?: string[];
    resources?: WorkResource[];
}
/** Literal, finite resource declarations, never glob patterns or executable rules. */
export declare function responsibility(value: unknown): WorkResponsibility;
export declare function resourceKeys(value: WorkResponsibility): string[];
export declare function assignmentShape(value?: WorkResponsibility): {
    perspective: string | undefined;
    mode: "advice" | "alternative" | "exclusive_write" | undefined;
    resources: WorkResource[] | undefined;
};
//# sourceMappingURL=work-responsibility.d.ts.map