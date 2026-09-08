#!/usr/bin/env node
import { type EnterpriseServerConfig, type EnterpriseServerHandle } from './src/enterprise-server.js';
export interface EnterpriseServerIo {
    stdout(value: string): void;
    stderr(value: string): void;
}
export declare function parseEnterpriseServerArgs(argv: string[]): EnterpriseServerConfig;
export declare function runEnterpriseServer(argv: string[], io?: EnterpriseServerIo): Promise<EnterpriseServerHandle | undefined>;
//# sourceMappingURL=enterprise-server.d.ts.map