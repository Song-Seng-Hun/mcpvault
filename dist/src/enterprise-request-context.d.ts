export interface EnterpriseRequestContext {
    transport: 'http' | 'rest' | 'stdio';
    certFingerprint?: string;
}
export declare function getEnterpriseRequestContext(): EnterpriseRequestContext | undefined;
export declare function withEnterpriseRequestContext<T>(context: EnterpriseRequestContext, callback: () => T): T;
//# sourceMappingURL=enterprise-request-context.d.ts.map