import { Server } from "@modelcontextprotocol/server";
import { FrontmatterHandler } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { type PublicFederationHostConfig } from './enterprise-federation.js';
import type { RoleplayStore } from './roleplay-store.js';
import { EndpointRegistry } from "./endpoint-registry.js";
import { type EconomyLedger } from './economy-ledger.js';
import type { EconomyPolicy } from './economy-model.js';
export interface CreateServerOptions {
    /** Host-provisioned single world; no caller or Vault note can enable this. */
    roleplay?: RoleplayStore;
    /** Host-provisioned ledger only. Never initialized or funded from MCP. */
    economy?: {
        ledger: EconomyLedger;
        policy: EconomyPolicy;
    };
    /** Opt-in host-private enterprise registry. Never inferred from Vault content. */
    enterpriseRegistryPath?: string;
    publicFederation?: PublicFederationHostConfig;
    name?: string;
    version?: string;
    pathFilter?: PathFilter;
    frontmatterHandler?: FrontmatterHandler;
    /** Expose read tools only and reject direct calls to mutating tools. */
    readOnly?: boolean;
    /** Account IDs granted the site-wide moderation capability. */
    moderatorAccounts?: string[];
    /** Stable namespace for this server's private community. */
    commandCenterId?: string;
}
export interface ServerRuntime {
    endpointRegistry: EndpointRegistry;
    dispatchTool: (requestedToolName: string, args?: Record<string, unknown>) => Promise<any>;
    ensureEndpointRegistry: () => void;
    createRequestServer: () => Server;
}
export declare function getServerRuntime(server: Server): ServerRuntime | undefined;
export declare function createServer(vaultPath: string, options?: CreateServerOptions): Server;
//# sourceMappingURL=createServer.d.ts.map