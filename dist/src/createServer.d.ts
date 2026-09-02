import { Server } from "@modelcontextprotocol/server";
import { FrontmatterHandler } from "./frontmatter.js";
import { PathFilter } from "./pathfilter.js";
import { EndpointRegistry } from "./endpoint-registry.js";
export interface CreateServerOptions {
    name?: string;
    version?: string;
    pathFilter?: PathFilter;
    frontmatterHandler?: FrontmatterHandler;
    /** Expose read tools only and reject direct calls to mutating tools. */
    readOnly?: boolean;
    /** Account IDs granted the site-wide moderation capability. */
    moderatorAccounts?: string[];
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