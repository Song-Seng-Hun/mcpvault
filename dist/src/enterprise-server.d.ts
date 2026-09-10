import { type EnterpriseMode } from './enterprise-registry.js';
import { type GlobalImportResult } from './global-sync.js';
export interface EnterpriseServerConfig {
    registryPath: string;
    realmId: string;
    host: string;
    port: number;
    certPath: string;
    keyPath: string;
    caPath: string;
    federationConfigPath?: string;
    globalImportConfigPath?: string;
}
export interface EnterpriseServerHandle {
    host: string;
    port: number;
    path: '/mcp';
    protocol: 'https';
    transport: 'mcp-http';
    vaultPath: string;
    registryPath: string;
    realmId: string;
    mode: EnterpriseMode;
    globalImport?: GlobalImportResult;
    close(): Promise<void>;
}
export declare function startEnterpriseServer(config: EnterpriseServerConfig): Promise<EnterpriseServerHandle>;
export declare function enterpriseServerHelp(): string;
//# sourceMappingURL=enterprise-server.d.ts.map