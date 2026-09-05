export interface LintDiagnostic {
    path: string;
    code: string;
    severity: 'error' | 'warning';
    revision?: string;
    detail: string;
}
export interface LintReportInput {
    healthy: boolean;
    errors: number;
    warnings: number;
    issues: LintDiagnostic[];
    truncated: boolean;
}
export interface LintReport {
    advisory: true;
    basis: 'known_source_snapshot';
    truncated: boolean;
    healthy?: boolean;
    errors?: number;
    warnings?: number;
    issues?: Array<Omit<LintDiagnostic, 'detail'> & {
        detail?: string;
    }>;
    nextAction?: {
        endpointId: 'notes.read';
        arguments: {
            path: string;
            maxChars: number;
        };
    };
    retry?: {
        endpointId: string;
        reuseOriginalArguments: true;
        overrides: {
            maxChars: number;
        };
    };
}
/** Presentation only: never change the internal lint/commit-validation totals. */
export declare function packLintReport(input: LintReportInput, maxChars: number, endpointId?: string): LintReport;
//# sourceMappingURL=lint-report.d.ts.map