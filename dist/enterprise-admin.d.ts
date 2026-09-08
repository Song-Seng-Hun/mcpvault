#!/usr/bin/env node
interface AdminIo {
    stdout: (value: string) => void;
    stderr: (value: string) => void;
    now?: () => Date;
}
interface MigrationAccount {
    accountId: string;
    modelId: string;
    agentId?: string;
    userId: string;
    role: 'model' | 'agent';
}
export declare function previewAccountMigration(accountsPathInput: string, limitInput?: number): {
    total: number;
    shown: number;
    truncated: boolean;
    accounts: MigrationAccount[];
};
export declare function runEnterpriseAdmin(argv: string[], io?: AdminIo): Promise<number>;
export {};
//# sourceMappingURL=enterprise-admin.d.ts.map