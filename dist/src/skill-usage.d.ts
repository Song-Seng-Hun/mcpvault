export type SkillUsageVersion = {
    skillId: string;
    path: string;
    revision: string;
};
export declare function skillUsageTaskId(value: unknown): string | undefined;
/** Private, bounded process observations. No transcript, host path, token or persistent file. */
export declare class SkillUsageTelemetry {
    private readonly capacity;
    private readonly startedAt;
    private readonly entries;
    private readonly receipts;
    private readonly tasks;
    private saturated;
    constructor(capacity?: number);
    private entry;
    resolved(actor: string | undefined, v: SkillUsageVersion): void;
    reported(actor: string | undefined, v: SkillUsageVersion, receipt: string, taskId: string | undefined, outcome: string): void;
    snapshot(actor: string | undefined, v: SkillUsageVersion): {
        coverage: string;
        observedSince: string;
        storage: string;
        resolvedCalls: number | null;
        reportedApplications: number | null;
        reportedSuccesses: number | null;
        verifiedApplications: null;
        receiptAcknowledged: null;
        lastObserved: string | null;
        retirementDecision: string;
        coUsed: (SkillUsageVersion & {
            tasks: number;
            basis: 'caller_reported_task';
        })[];
        notice: string;
    };
}
//# sourceMappingURL=skill-usage.d.ts.map